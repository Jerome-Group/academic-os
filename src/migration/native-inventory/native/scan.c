#define _DARWIN_C_SOURCE
#include <CommonCrypto/CommonDigest.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/stat.h>
#include <sys/xattr.h>
#include <unistd.h>

#define MAX_ATTRIBUTE (32 * 1024 * 1024)
#define MAX_DEPTH 256
#define MAX_ENTRIES 1000000

static unsigned long entries;
static dev_t root_device;
static int pass;

static void hex(const void *data, size_t count) {
  const unsigned char *bytes = data;
  for (size_t i = 0; i < count; i++) printf("%02x", bytes[i]);
}

static void digest(const void *data, size_t count) {
  unsigned char value[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data, (CC_LONG)count, value);
  hex(value, sizeof(value));
}

static void issue(const char *path, const char *code, int error) {
  printf("{\"record\":\"diagnostic\",\"pass\":%d,\"pathHex\":\"", pass);
  hex(path, strlen(path));
  printf("\",\"code\":\"%s\",\"errno\":%d}\n", code, error);
}

static void nanoseconds(struct timespec time) {
  __int128 value = (__int128)time.tv_sec * 1000000000 + time.tv_nsec;
  char digits[64]; size_t count = 0;
  putchar('"');
  if (value < 0) { putchar('-'); value = -value; }
  do { digits[count++] = (char)('0' + value % 10); value /= 10; } while (value);
  while (count) putchar(digits[--count]);
  putchar('"');
}

static void stat_json(const struct stat *s) {
  printf("{\"device\":\"%ju\",\"inode\":\"%ju\",\"mode\":%u,"
         "\"uid\":%u,\"gid\":%u,\"size\":\"%jd\",\"links\":\"%ju\","
         "\"flags\":%u,\"rdev\":\"%ju\",\"mtimeNs\":",
         (uintmax_t)s->st_dev, (uintmax_t)s->st_ino, s->st_mode,
         s->st_uid, s->st_gid, (intmax_t)s->st_size, (uintmax_t)s->st_nlink,
         s->st_flags, (uintmax_t)s->st_rdev);
  nanoseconds(s->st_mtimespec); printf(",\"ctimeNs\":");
  nanoseconds(s->st_ctimespec); printf(",\"birthtimeNs\":");
  nanoseconds(s->st_birthtimespec); printf(",\"atimeNs\":");
  nanoseconds(s->st_atimespec); printf("}");
}

static int same(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
    a->st_mode == b->st_mode && a->st_uid == b->st_uid && a->st_gid == b->st_gid &&
    a->st_rdev == b->st_rdev && a->st_size == b->st_size && a->st_nlink == b->st_nlink && a->st_flags == b->st_flags &&
    a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec &&
    a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
    a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec &&
    a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec &&
    a->st_birthtimespec.tv_sec == b->st_birthtimespec.tv_sec &&
    a->st_birthtimespec.tv_nsec == b->st_birthtimespec.tv_nsec;
}

static const char *kind(mode_t mode) {
  if (S_ISREG(mode)) return "file";
  if (S_ISDIR(mode)) return "directory";
  if (S_ISLNK(mode)) return "symlink";
  if (S_ISFIFO(mode)) return "fifo";
  if (S_ISCHR(mode)) return "character-device";
  if (S_ISBLK(mode)) return "block-device";
  if (S_ISSOCK(mode)) return "socket";
  return "unknown";
}

static int compare_names(const void *a, const void *b) {
  return strcmp(*(char *const *)a, *(char *const *)b);
}

static int acl_json(int fd) {
  errno = 0;
  acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
  if (acl == NULL) {
    if (errno != ENOENT) { printf("null"); return -1; }
    printf("{\"encoding\":\"darwin-acl-copy-ext\",\"valueHex\":\"\",\"sha256\":\"");
    digest("", 0); printf("\"}"); return 0;
  }
  ssize_t size = acl_size(acl);
  void *bytes = size < 0 || size > MAX_ATTRIBUTE ? NULL : calloc(1, (size_t)size);
  if (bytes == NULL) { acl_free(acl); printf("null"); return -1; }
  ssize_t count = acl_copy_ext(bytes, acl, size);
  if (count < 0) { free(bytes); acl_free(acl); printf("null"); return -1; }
  printf("{\"encoding\":\"darwin-acl-copy-ext\",\"valueHex\":\"");
  hex(bytes, (size_t)count); printf("\",\"sha256\":\""); digest(bytes, (size_t)count);
  printf("\"}"); free(bytes); acl_free(acl); return 0;
}

static int xattrs_json(int fd) {
  ssize_t size = flistxattr(fd, NULL, 0, XATTR_SHOWCOMPRESSION);
  if (size < 0 || size > MAX_ATTRIBUTE) { printf("null"); return -1; }
  char *bytes = calloc((size_t)size + 1, 1);
  if (bytes == NULL) { printf("null"); return -1; }
  ssize_t count = flistxattr(fd, bytes, (size_t)size, XATTR_SHOWCOMPRESSION);
  if (count < 0 || count != size) { free(bytes); printf("null"); return -1; }
  size_t length = 0;
  for (ssize_t i = 0; i < count; i++) if (bytes[i] == '\0') length++;
  char **names = calloc(length + 1, sizeof(char *));
  if (names == NULL) { free(bytes); printf("null"); return -1; }
  size_t index = 0;
  for (ssize_t i = 0; i < count;) {
    size_t remaining = (size_t)(count - i);
    size_t n = strnlen(bytes + i, remaining);
    if (n == 0 || n == remaining) { free(names); free(bytes); printf("null"); return -1; }
    names[index++] = bytes + i; i += (ssize_t)n + 1;
  }
  qsort(names, index, sizeof(char *), compare_names);
  printf("["); int failure = 0;
  for (size_t i = 0; i < index; i++) {
    if (i) printf(",");
    printf("{\"nameHex\":\""); hex(names[i], strlen(names[i])); printf("\",\"payload\":");
    ssize_t n = fgetxattr(fd, names[i], NULL, 0, 0, XATTR_SHOWCOMPRESSION);
    void *value = n < 0 || n > MAX_ATTRIBUTE ? NULL : malloc((size_t)n + 1);
    ssize_t actual = value == NULL ? -1 : fgetxattr(fd, names[i], value, (size_t)n, 0, XATTR_SHOWCOMPRESSION);
    if (actual < 0 || actual != n) { printf("null"); failure = -1; }
    else {
      printf("{\"valueHex\":\""); hex(value, (size_t)n);
      printf("\",\"sha256\":\""); digest(value, (size_t)n); printf("\"}");
    }
    printf("}"); free(value);
  }
  printf("]"); free(names); free(bytes); return failure;
}

static int file_digest(int fd, unsigned char *value) {
  CC_SHA256_CTX hash; CC_SHA256_Init(&hash);
  char buffer[65536]; ssize_t size;
  while ((size = read(fd, buffer, sizeof(buffer))) > 0)
    CC_SHA256_Update(&hash, buffer, (CC_LONG)size);
  if (size < 0) return -1;
  CC_SHA256_Final(value, &hash); return 0;
}

static void scan(int parent, const char *name, const char *path, unsigned depth);

static void children(int fd, const char *path, unsigned depth) {
  int duplicate = dup(fd);
  DIR *directory = duplicate < 0 ? NULL : fdopendir(duplicate);
  if (directory == NULL) { if (duplicate >= 0) close(duplicate); issue(path, "directory-unreadable", errno); return; }
  char **names = NULL; size_t count = 0; struct dirent *entry;
  errno = 0;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    if (count >= MAX_ENTRIES) { issue(path, "entry-limit", 0); break; }
    char **next = realloc(names, (count + 1) * sizeof(char *));
    if (next == NULL) { issue(path, "allocation-failed", errno); break; }
    names = next; names[count] = strdup(entry->d_name);
    if (names[count] == NULL) { issue(path, "allocation-failed", errno); break; }
    count++;
  }
  if (errno) issue(path, "directory-unreadable", errno);
  closedir(directory); qsort(names, count, sizeof(char *), compare_names);
  for (size_t i = 0; i < count; i++) {
    size_t n = strlen(path) + strlen(names[i]) + 2;
    char *child = malloc(n);
    if (child == NULL) issue(path, "allocation-failed", errno);
    else {
      snprintf(child, n, "%s%s%s", path, path[0] ? "/" : "", names[i]);
      scan(fd, names[i], child, depth + 1); free(child);
    }
    free(names[i]);
  }
  free(names);
}

static void scan(int parent, const char *name, const char *path, unsigned depth) {
  if (depth > MAX_DEPTH || ++entries > MAX_ENTRIES) { issue(path, "inventory-limit", 0); return; }
  struct stat before, opened, after;
  if (fstatat(parent, name, &before, AT_SYMLINK_NOFOLLOW) != 0) { issue(path, "entry-unreadable", errno); return; }
  if (before.st_dev != root_device) { issue(path, "cross-device-entry", 0); return; }
  if (before.st_flags & SF_DATALESS) { issue(path, "dataless-entry", 0); return; }
  int fd = -1;
  if (S_ISREG(before.st_mode) || S_ISDIR(before.st_mode) || S_ISLNK(before.st_mode)) {
    int options = O_RDONLY | O_CLOEXEC | O_NONBLOCK;
    options |= S_ISLNK(before.st_mode) ? O_SYMLINK : O_NOFOLLOW;
    if (S_ISDIR(before.st_mode)) options |= O_DIRECTORY;
    fd = openat(parent, name, options);
    if (fd < 0) { issue(path, "entry-unreadable", errno); return; }
    if (fstat(fd, &opened) != 0 || !same(&before, &opened)) {
      issue(path, "source-changed", 0); close(fd); return;
    }
  }
  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  int data_error = S_ISREG(before.st_mode) ? file_digest(fd, hash) : 0;
  char *target = NULL; ssize_t target_length = 0;
  if (S_ISLNK(before.st_mode)) {
    target = malloc(1024 * 1024);
    target_length = target == NULL ? -1 : readlinkat(parent, name, target, 1024 * 1024);
    if (target_length < 0 || target_length == 1024 * 1024) issue(path, "link-unreadable", errno);
  }
  printf("{\"record\":\"entry\",\"pass\":%d,\"pathHex\":\"", pass); hex(path, strlen(path));
  printf("\",\"kind\":\"%s\",\"before\":", kind(before.st_mode)); stat_json(&before);
  printf(",\"dataSha256\":");
  if (S_ISREG(before.st_mode) && data_error == 0) { printf("\""); hex(hash, sizeof(hash)); printf("\""); } else printf("null");
  printf(",\"linkTargetHex\":");
  if (target != NULL && target_length >= 0 && target_length < 1024 * 1024) { printf("\""); hex(target, (size_t)target_length); printf("\""); } else printf("null");
  free(target);
  printf(",\"acl\":"); int acl_error = fd < 0 ? -1 : acl_json(fd); if (fd < 0) printf("null");
  printf(",\"xattrs\":"); int xattr_error = fd < 0 ? -1 : xattrs_json(fd); if (fd < 0) printf("null");
  printf(",\"after\":");
  int after_error = fstatat(parent, name, &after, AT_SYMLINK_NOFOLLOW);
  if (after_error == 0) stat_json(&after); else printf("null");
  printf("}\n");
  if (data_error) issue(path, "data-unreadable", errno);
  if (acl_error) issue(path, "acl-unreadable", 0);
  if (xattr_error) issue(path, "xattrs-unreadable", 0);
  if (after_error || !same(&before, &after)) issue(path, "source-changed", 0);
  if (S_ISDIR(before.st_mode)) {
    children(fd, path, depth);
    if (fstatat(parent, name, &after, AT_SYMLINK_NOFOLLOW) != 0 || !same(&before, &after))
      issue(path, "source-changed", 0);
  }
  if (fd >= 0) close(fd);
}

int main(int argc, char **argv) {
  if (argc != 2 || argv[1][0] != '/') return 64;
  int fds[MAX_DEPTH + 1]; char *names[MAX_DEPTH + 1]; struct stat identities[MAX_DEPTH + 1];
  size_t count = 0; fds[0] = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fds[0] < 0) return 65;
  char *input = strdup(argv[1]); if (input == NULL) return 66;
  char *save = NULL; char *name = strtok_r(input, "/", &save);
  while (name != NULL) {
    if (count == MAX_DEPTH || strcmp(name, ".") == 0 || strcmp(name, "..") == 0) { issue("", "root-alias", 0); return 0; }
    struct stat before;
    if (fstatat(fds[count], name, &before, AT_SYMLINK_NOFOLLOW) != 0 || !S_ISDIR(before.st_mode) || (before.st_flags & SF_DATALESS)) { issue("", "root-unavailable-or-aliased", errno); return 0; }
    int next = openat(fds[count], name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    struct stat opened;
    if (next < 0 || fstat(next, &opened) != 0 || !same(&before, &opened)) { issue("", "root-changed", errno); return 0; }
    names[count] = name; identities[count] = before; fds[++count] = next;
    name = strtok_r(NULL, "/", &save);
  }
  struct stat root; if (fstat(fds[count], &root) != 0) return 67;
  root_device = root.st_dev;
  for (pass = 1; pass <= 2; pass++) {
    entries = 0;
    scan(fds[count], ".", "", 0);
    for (size_t i = 0; i < count; i++) {
      struct stat current;
      if (fstatat(fds[i], names[i], &current, AT_SYMLINK_NOFOLLOW) != 0 ||
          current.st_dev != identities[i].st_dev || current.st_ino != identities[i].st_ino || !S_ISDIR(current.st_mode))
        issue("", "root-changed", 0);
    }
  }
  for (size_t i = 0; i <= count; i++) close(fds[i]);
  free(input); return ferror(stdout) ? 68 : 0;
}
