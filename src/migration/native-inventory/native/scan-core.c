#define _DARWIN_C_SOURCE
#include "scan-core.h"
#include <CommonCrypto/CommonDigest.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/xattr.h>
#include <unistd.h>

_Static_assert(NAME_MAX <= 255, "Native inventory requires bounded raw names.");

typedef enum { SCANNING, SINK_REJECTED, LIMIT_REACHED } ScanStatus;

typedef struct {
  const AosScanSink *sink;
  unsigned pass;
  size_t discovered, live_bytes;
  dev_t root_device;
  ScanStatus status;
} ScanContext;

/* Queued names, growing pointer arrays, active paths and one metadata value. */
static const size_t maximum_live_bytes =
  (size_t)AOS_SCAN_MAX_ENTRIES * (NAME_MAX + 1 + 3 * sizeof(char *)) +
  (size_t)(AOS_SCAN_MAX_DEPTH + 1) * (AOS_SCAN_MAX_DEPTH + 1) * (NAME_MAX + 1) +
  (size_t)AOS_SCAN_MAX_ATTRIBUTE * (2 + sizeof(char *) / 2) +
  1024 * 1024 + AOS_SCAN_WINDOW;

static AosScanBytes bytes(const void *value, size_t length) {
  return (AosScanBytes){value, length};
}
static AosScanBytes name_bytes(const char *value) { return bytes(value, strlen(value)); }
static int delivered(ScanContext *scan, int result) {
  if (result) scan->status = SINK_REJECTED;
  return scan->status;
}
static void issue(ScanContext *scan, const char *path, AosScanDiagnostic code, int error) {
  if (scan->status != SINK_REJECTED)
    delivered(scan, scan->sink->diagnostic(scan->sink->context, scan->pass, name_bytes(path), code, error));
}
static void *allocate(ScanContext *scan, size_t count, size_t width) {
  if (width && count > SIZE_MAX / width) { errno = ENOMEM; return NULL; }
  size_t length = count * width;
  if (length > maximum_live_bytes - scan->live_bytes) { errno = ENOMEM; return NULL; }
  void *value = malloc(length ? length : 1);
  if (value) scan->live_bytes += length;
  return value;
}
static void release(ScanContext *scan, void *value, size_t length) {
  if (value) { free(value); scan->live_bytes -= length; }
}

int aos_scan_stat_equal(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
    a->st_mode == b->st_mode && a->st_uid == b->st_uid && a->st_gid == b->st_gid &&
    a->st_rdev == b->st_rdev && a->st_size == b->st_size && a->st_nlink == b->st_nlink && a->st_flags == b->st_flags &&
    a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
    a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec &&
    a->st_birthtimespec.tv_sec == b->st_birthtimespec.tv_sec && a->st_birthtimespec.tv_nsec == b->st_birthtimespec.tv_nsec;
}
static int compare_names(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }
static int unavailable(ScanContext *scan, AosScanValueKind kind, AosScanBytes name) {
  delivered(scan, scan->sink->value_unavailable(scan->sink->context, kind, name));
  return -1;
}
static void value(ScanContext *scan, AosScanValueKind kind, AosScanBytes name, const void *data, size_t length) {
  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  if (kind != AOS_SCAN_LINK) CC_SHA256(data, (CC_LONG)length, hash);
  if (delivered(scan, scan->sink->value_begin(scan->sink->context, kind, name, length, kind == AOS_SCAN_LINK ? NULL : hash))) return;
  for (size_t offset = 0; offset < length && !scan->status;) {
    size_t count = length - offset;
    if (count > AOS_SCAN_WINDOW) count = AOS_SCAN_WINDOW;
    delivered(scan, scan->sink->value_bytes(scan->sink->context, bytes((const unsigned char *)data + offset, count)));
    offset += count;
  }
  if (!scan->status) delivered(scan, scan->sink->value_end(scan->sink->context, kind));
}

static int acl_value(ScanContext *scan, int fd) {
  errno = 0;
  acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
  if (!acl) {
    if (errno != ENOENT) return unavailable(scan, AOS_SCAN_ACL, bytes(NULL, 0));
    value(scan, AOS_SCAN_ACL, bytes(NULL, 0), "", 0); return 0;
  }
  ssize_t length = acl_size(acl);
  void *data = length < 0 || length > AOS_SCAN_MAX_ATTRIBUTE ? NULL : allocate(scan, (size_t)length, 1);
  if (!data) { acl_free(acl); return unavailable(scan, AOS_SCAN_ACL, bytes(NULL, 0)); }
  ssize_t count = acl_copy_ext(data, acl, length);
  acl_free(acl);
  if (count < 0 || count > length) {
    release(scan, data, (size_t)length); return unavailable(scan, AOS_SCAN_ACL, bytes(NULL, 0));
  }
  value(scan, AOS_SCAN_ACL, bytes(NULL, 0), data, (size_t)count);
  release(scan, data, (size_t)length); return 0;
}

static int xattrs(ScanContext *scan, int fd) {
  ssize_t length = flistxattr(fd, NULL, 0, XATTR_SHOWCOMPRESSION);
  if (length < 0 || length > AOS_SCAN_MAX_ATTRIBUTE) return unavailable(scan, AOS_SCAN_XATTR, bytes(NULL, 0));
  char *data = allocate(scan, (size_t)length + 1, 1);
  if (!data) return unavailable(scan, AOS_SCAN_XATTR, bytes(NULL, 0));
  ssize_t actual = flistxattr(fd, data, (size_t)length, XATTR_SHOWCOMPRESSION);
  if (actual != length) {
    release(scan, data, (size_t)length + 1); return unavailable(scan, AOS_SCAN_XATTR, bytes(NULL, 0));
  }
  size_t count = 0;
  for (ssize_t i = 0; i < length; i++) if (!data[i]) count++;
  if (count > (size_t)length / 2) {
    release(scan, data, (size_t)length + 1); return unavailable(scan, AOS_SCAN_XATTR, bytes(NULL, 0));
  }
  char **names = allocate(scan, count + 1, sizeof(char *));
  if (!names) { release(scan, data, (size_t)length + 1); return unavailable(scan, AOS_SCAN_XATTR, bytes(NULL, 0)); }
  size_t index = 0;
  for (size_t offset = 0; offset < (size_t)length;) {
    size_t remaining = (size_t)length - offset;
    size_t n = strnlen(data + offset, remaining);
    if (!n || n == remaining || n > XATTR_MAXNAMELEN) {
      release(scan, names, (count + 1) * sizeof(char *)); release(scan, data, (size_t)length + 1);
      return unavailable(scan, AOS_SCAN_XATTR, bytes(NULL, 0));
    }
    names[index++] = data + offset; offset += n + 1;
  }
  qsort(names, index, sizeof(char *), compare_names);
  delivered(scan, scan->sink->xattrs_begin(scan->sink->context));
  int failure = 0;
  for (size_t i = 0; i < index && !scan->status; i++) {
    AosScanBytes name = name_bytes(names[i]);
    ssize_t size = fgetxattr(fd, names[i], NULL, 0, 0, XATTR_SHOWCOMPRESSION);
    void *payload = size < 0 || size > AOS_SCAN_MAX_ATTRIBUTE ? NULL : allocate(scan, (size_t)size + 1, 1);
    ssize_t observed = payload ? fgetxattr(fd, names[i], payload, (size_t)size, 0, XATTR_SHOWCOMPRESSION) : -1;
    if (observed < 0 || observed != size) failure = unavailable(scan, AOS_SCAN_XATTR, name);
    else value(scan, AOS_SCAN_XATTR, name, payload, (size_t)size);
    if (payload) release(scan, payload, (size_t)size + 1);
  }
  if (!scan->status) delivered(scan, scan->sink->xattrs_end(scan->sink->context));
  release(scan, names, (count + 1) * sizeof(char *)); release(scan, data, (size_t)length + 1);
  return failure;
}

static int file_digest(int fd, unsigned char *value) {
  CC_SHA256_CTX hash; CC_SHA256_Init(&hash);
  char buffer[AOS_SCAN_WINDOW]; ssize_t size;
  while ((size = read(fd, buffer, sizeof(buffer))) > 0) CC_SHA256_Update(&hash, buffer, (CC_LONG)size);
  if (size < 0) return -1;
  CC_SHA256_Final(value, &hash); return 0;
}

static void entry(ScanContext *, int, const char *, const char *, unsigned);
static void children(ScanContext *scan, int fd, const char *path, unsigned depth) {
  int duplicate = dup(fd);
  DIR *directory = duplicate < 0 ? NULL : fdopendir(duplicate);
  if (!directory) { if (duplicate >= 0) close(duplicate); issue(scan, path, AOS_SCAN_DIRECTORY_UNREADABLE, errno); return; }
  char **names = NULL; size_t count = 0, capacity = 0;
  errno = 0;
  struct dirent *child;
  while (!scan->status && (child = readdir(directory))) {
    if (!strcmp(child->d_name, ".") || !strcmp(child->d_name, "..")) continue;
    if (scan->discovered == AOS_SCAN_MAX_ENTRIES) {
      issue(scan, path, AOS_SCAN_INVENTORY_LIMIT, 0);
      if (scan->status != SINK_REJECTED) scan->status = LIMIT_REACHED;
      break;
    }
    size_t length = strnlen(child->d_name, NAME_MAX + 1);
    if (!length || length > NAME_MAX) { issue(scan, path, AOS_SCAN_DIRECTORY_UNREADABLE, 0); break; }
    if (count == capacity) {
      size_t next = capacity ? capacity * 2 : 8;
      if (next > AOS_SCAN_MAX_ENTRIES) next = AOS_SCAN_MAX_ENTRIES;
      char **grown = allocate(scan, next, sizeof(char *));
      if (!grown) { issue(scan, path, AOS_SCAN_ALLOCATION_FAILED, errno); break; }
      if (count) memcpy(grown, names, count * sizeof(char *));
      release(scan, names, capacity * sizeof(char *)); names = grown; capacity = next;
    }
    char *name = allocate(scan, length + 1, 1);
    if (!name) { issue(scan, path, AOS_SCAN_ALLOCATION_FAILED, errno); break; }
    memcpy(name, child->d_name, length + 1); names[count++] = name; scan->discovered++;
  }
  if (errno) issue(scan, path, AOS_SCAN_DIRECTORY_UNREADABLE, errno);
  closedir(directory); qsort(names, count, sizeof(char *), compare_names);
  for (size_t i = 0; i < count; i++) {
    size_t parent_length = strlen(path), name_length = strlen(names[i]);
    size_t length = parent_length + name_length + 2;
    char *child_path = scan->status ? NULL : allocate(scan, length, 1);
    if (!child_path) { if (!scan->status) issue(scan, path, AOS_SCAN_ALLOCATION_FAILED, errno); }
    else {
      memcpy(child_path, path, parent_length);
      size_t offset = parent_length;
      if (offset) child_path[offset++] = '/';
      memcpy(child_path + offset, names[i], name_length + 1);
      entry(scan, fd, names[i], child_path, depth + 1); release(scan, child_path, length);
    }
    release(scan, names[i], name_length + 1);
  }
  release(scan, names, capacity * sizeof(char *));
}

static void entry(ScanContext *scan, int parent, const char *name, const char *path, unsigned depth) {
  if (scan->status) return;
  if (depth > AOS_SCAN_MAX_DEPTH) { issue(scan, path, AOS_SCAN_INVENTORY_LIMIT, 0); return; }
  struct stat before, opened, after;
  if (fstatat(parent, name, &before, AT_SYMLINK_NOFOLLOW)) { issue(scan, path, AOS_SCAN_ENTRY_UNREADABLE, errno); return; }
  if (before.st_dev != scan->root_device) { issue(scan, path, AOS_SCAN_CROSS_DEVICE, 0); return; }
  if (before.st_flags & SF_DATALESS) { issue(scan, path, AOS_SCAN_DATALESS, 0); return; }
  int fd = -1;
  if (S_ISREG(before.st_mode) || S_ISDIR(before.st_mode) || S_ISLNK(before.st_mode)) {
    int flags = O_RDONLY | O_CLOEXEC | O_NONBLOCK;
    flags |= S_ISLNK(before.st_mode) ? O_SYMLINK : O_NOFOLLOW;
    if (S_ISDIR(before.st_mode)) flags |= O_DIRECTORY;
    fd = openat(parent, name, flags);
    if (fd < 0) { issue(scan, path, AOS_SCAN_ENTRY_UNREADABLE, errno); return; }
    if (fstat(fd, &opened) || !aos_scan_stat_equal(&before, &opened)) { issue(scan, path, AOS_SCAN_SOURCE_CHANGED, 0); close(fd); return; }
  }
  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  int data_error = S_ISREG(before.st_mode) ? file_digest(fd, hash) : 0;
  const size_t target_capacity = 1024 * 1024;
  char *target = NULL; ssize_t target_length = -1;
  if (S_ISLNK(before.st_mode)) {
    target = allocate(scan, target_capacity, 1);
    target_length = target ? readlinkat(parent, name, target, target_capacity) : -1;
    if (target_length < 0 || target_length == (ssize_t)target_capacity) issue(scan, path, AOS_SCAN_LINK_UNREADABLE, errno);
  }
  AosScanEntry observed = {scan->pass, name_bytes(path), before, S_ISREG(before.st_mode) && !data_error ? hash : NULL};
  if (!scan->status) delivered(scan, scan->sink->entry_begin(scan->sink->context, &observed));
  if (!scan->status) {
    if (target && target_length >= 0 && target_length < (ssize_t)target_capacity) value(scan, AOS_SCAN_LINK, bytes(NULL, 0), target, (size_t)target_length);
    else unavailable(scan, AOS_SCAN_LINK, bytes(NULL, 0));
  }
  release(scan, target, target_capacity);
  int acl_error = 0, xattr_error = 0;
  if (!scan->status) acl_error = fd < 0 ? unavailable(scan, AOS_SCAN_ACL, bytes(NULL, 0)) : acl_value(scan, fd);
  if (!scan->status) xattr_error = fd < 0 ? unavailable(scan, AOS_SCAN_XATTR, bytes(NULL, 0)) : xattrs(scan, fd);
  int after_error = fstatat(parent, name, &after, AT_SYMLINK_NOFOLLOW);
  if (!scan->status) delivered(scan, scan->sink->entry_end(scan->sink->context, after_error ? NULL : &after));
  if (data_error) issue(scan, path, AOS_SCAN_DATA_UNREADABLE, errno);
  if (acl_error) issue(scan, path, AOS_SCAN_ACL_UNREADABLE, 0);
  if (xattr_error) issue(scan, path, AOS_SCAN_XATTRS_UNREADABLE, 0);
  if (after_error || !aos_scan_stat_equal(&before, &after)) issue(scan, path, AOS_SCAN_SOURCE_CHANGED, 0);
  if (S_ISDIR(before.st_mode) && !scan->status) {
    children(scan, fd, path, depth);
    if (fstatat(parent, name, &after, AT_SYMLINK_NOFOLLOW) || !aos_scan_stat_equal(&before, &after)) issue(scan, path, AOS_SCAN_SOURCE_CHANGED, 0);
  }
  if (fd >= 0) close(fd);
}

int aos_scan_pass(int root_fd, unsigned pass, const AosScanSink *sink) {
  if (!sink || !sink->entry_begin || !sink->value_begin || !sink->value_bytes || !sink->value_end ||
      !sink->value_unavailable || !sink->xattrs_begin || !sink->xattrs_end || !sink->entry_end || !sink->diagnostic ||
      (pass != 1 && pass != 2)) return -1;
  struct stat root;
  if (fstat(root_fd, &root) || !S_ISDIR(root.st_mode)) return -1;
  ScanContext scan = {sink, pass, 1, 0, root.st_dev, 0};
  entry(&scan, root_fd, ".", "", 0);
  return scan.status == SINK_REJECTED ? 1 : 0;
}
