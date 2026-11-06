#define _DARWIN_C_SOURCE
#include "scan-core.h"
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct { size_t xattrs; unsigned char hash[32]; } Formatter;
static void hex(const void *data, size_t count) {
  const unsigned char *bytes = data;
  for (size_t i = 0; i < count; i++) printf("%02x", bytes[i]);
}
static void issue(unsigned pass, const char *path, const char *code, int error) {
  printf("{\"record\":\"diagnostic\",\"pass\":%u,\"pathHex\":\"", pass);
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


static int entry_begin(void *context, const AosScanEntry *entry) {
  (void)context;
  printf("{\"record\":\"entry\",\"pass\":%u,\"pathHex\":\"", entry->pass);
  hex(entry->path.data, entry->path.length);
  printf("\",\"kind\":\"%s\",\"before\":", kind(entry->before.st_mode));
  stat_json(&entry->before);
  printf(",\"dataSha256\":");
  if (entry->data_sha256) { putchar('"'); hex(entry->data_sha256, 32); putchar('"'); }
  else printf("null");
  return ferror(stdout);
}
static void xattr_prefix(Formatter *formatter, AosScanBytes name) {
  if (formatter->xattrs++) putchar(',');
  printf("{\"nameHex\":\""); hex(name.data, name.length); printf("\",\"payload\":");
}
static int value_begin(void *context, AosScanValueKind kind, AosScanBytes name, size_t length, const unsigned char *hash) {
  Formatter *formatter = context;
  (void)length;
  if (kind == AOS_SCAN_LINK) printf(",\"linkTargetHex\":\"");
  else {
    memcpy(formatter->hash, hash, sizeof(formatter->hash));
    if (kind == AOS_SCAN_ACL) printf(",\"acl\":{\"encoding\":\"darwin-acl-copy-ext\",\"valueHex\":\"");
    else { xattr_prefix(formatter, name); printf("{\"valueHex\":\""); }
  }
  return ferror(stdout);
}
static int value_bytes(void *context, AosScanBytes value) {
  (void)context; hex(value.data, value.length); return ferror(stdout);
}
static int value_end(void *context, AosScanValueKind kind) {
  Formatter *formatter = context;
  putchar('"');
  if (kind != AOS_SCAN_LINK) {
    printf(",\"sha256\":\""); hex(formatter->hash, sizeof(formatter->hash)); printf("\"}");
    if (kind == AOS_SCAN_XATTR) putchar('}');
  }
  return ferror(stdout);
}
static int value_unavailable(void *context, AosScanValueKind kind, AosScanBytes name) {
  if (kind == AOS_SCAN_LINK) printf(",\"linkTargetHex\":null");
  else if (kind == AOS_SCAN_ACL) printf(",\"acl\":null");
  else if (!name.length) printf(",\"xattrs\":null");
  else { xattr_prefix(context, name); printf("null}"); }
  return ferror(stdout);
}
static int xattrs_begin(void *context) {
  Formatter *formatter = context; formatter->xattrs = 0;
  printf(",\"xattrs\":["); return ferror(stdout);
}
static int xattrs_end(void *context) { (void)context; putchar(']'); return ferror(stdout); }
static int entry_end(void *context, const struct stat *after) {
  (void)context; printf(",\"after\":");
  if (after) stat_json(after); else printf("null");
  printf("}\n"); return ferror(stdout);
}
static int diagnostic(void *context, unsigned pass, AosScanBytes path, AosScanDiagnostic code, int error) {
  (void)context;
  static const char *codes[] = {
    "allocation-failed", "directory-unreadable", "entry-limit", "inventory-limit", "entry-unreadable",
    "cross-device-entry", "dataless-entry", "source-changed", "link-unreadable", "data-unreadable",
    "acl-unreadable", "xattrs-unreadable"
  };
  printf("{\"record\":\"diagnostic\",\"pass\":%u,\"pathHex\":\"", pass);
  hex(path.data, path.length);
  printf("\",\"code\":\"%s\",\"errno\":%d}\n", codes[code], error);
  return ferror(stdout);
}

int main(int argc, char **argv) {
  if (argc != 2 || argv[1][0] != '/') return 64;
  int fds[AOS_SCAN_MAX_DEPTH + 1]; char *names[AOS_SCAN_MAX_DEPTH + 1]; struct stat identities[AOS_SCAN_MAX_DEPTH + 1];
  size_t count = 0; fds[0] = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fds[0] < 0) return 65;
  char *input = strdup(argv[1]); if (input == NULL) return 66;
  char *save = NULL; char *name = strtok_r(input, "/", &save);
  while (name != NULL) {
    if (count == AOS_SCAN_MAX_DEPTH || strcmp(name, ".") == 0 || strcmp(name, "..") == 0) { issue(0, "", "root-alias", 0); return 0; }
    struct stat before;
    if (fstatat(fds[count], name, &before, AT_SYMLINK_NOFOLLOW) != 0 || !S_ISDIR(before.st_mode) || (before.st_flags & SF_DATALESS)) { issue(0, "", "root-unavailable-or-aliased", errno); return 0; }
    int next = openat(fds[count], name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    struct stat opened;
    if (next < 0 || fstat(next, &opened) != 0 || !aos_scan_stat_equal(&before, &opened)) { issue(0, "", "root-changed", errno); return 0; }
    names[count] = name; identities[count] = before; fds[++count] = next;
    name = strtok_r(NULL, "/", &save);
  }
  struct stat root; if (fstat(fds[count], &root) != 0) return 67;
  Formatter formatter = {0};
  AosScanSink sink = {&formatter, entry_begin, value_begin, value_bytes, value_end, value_unavailable, xattrs_begin, xattrs_end, entry_end, diagnostic};
  for (unsigned pass = 1; pass <= 2; pass++) {
    if (aos_scan_pass(fds[count], pass, &sink)) return 68;
    for (size_t i = 0; i < count; i++) {
      struct stat current;
      if (fstatat(fds[i], names[i], &current, AT_SYMLINK_NOFOLLOW) != 0 ||
          current.st_dev != identities[i].st_dev || current.st_ino != identities[i].st_ino || !S_ISDIR(current.st_mode))
        issue(pass, "", "root-changed", 0);
    }
  }
  for (size_t i = 0; i <= count; i++) close(fds[i]);
  free(input); return ferror(stdout) ? 68 : 0;
}
