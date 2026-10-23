export const shelfNativeSource = String.raw`
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <inttypes.h>
#ifdef __linux__
#include <sys/syscall.h>
#include <linux/fs.h>
#endif

static int receipt(const char *operation, const char *kind, const char *phase, int error) {
  printf("{\"version\":1,\"operation\":\"%s\",\"kind\":\"%s\",\"phase\":\"%s\",\"errno\":%d}\n",
    operation, kind, phase, error);
  return !strcmp(kind, "moved") ? 0 : !strcmp(kind, "refused") ? 10 : 20;
}
static int number(const char *s, uintmax_t *v) {
  char *end;
  for (const char *p = s; *p; p++) if (*p < '0' || *p > '9') return 0;
  errno = 0; *v = strtoumax(s, &end, 10);
  return !errno && s[0] && !end[0] && s[0] != '-';
}
static int name_ok(const char *name) {
  return name[0] && strcmp(name, ".") && strcmp(name, "..") &&
    !strchr(name, '/') && !strchr(name, '\\') && strlen(name) <= 255;
}
static int ordinary(const struct stat *s) {
#ifdef __APPLE__
  if (s->st_flags & SF_DATALESS) return 0;
#endif
  return S_ISREG(s->st_mode);
}
int main(int argc, char **argv) {
  const char *op = argc > 1 && !strcmp(argv[1], "exchange") ? "exchange" : "exclusive";
  uintmax_t rd, ri, sd, si, td, ti;
  if (argc != 10 || (strcmp(argv[1], "exclusive") && strcmp(argv[1], "exchange")) ||
      !name_ok(argv[2]) || !name_ok(argv[3]) || !strcmp(argv[2], argv[3]) ||
      !number(argv[4], &rd) || !number(argv[5], &ri) ||
      !number(argv[6], &sd) || !number(argv[7], &si) ||
      !number(argv[8], &td) || !number(argv[9], &ti))
    return receipt(op, "refused", "arguments", EINVAL);
  struct stat root, source, target;
  if (fstat(3, &root) || !S_ISDIR(root.st_mode) ||
      (uintmax_t)root.st_dev != rd || (uintmax_t)root.st_ino != ri)
    return receipt(op, "refused", "root", errno);
  if (fstatat(3, argv[2], &source, AT_SYMLINK_NOFOLLOW) || !ordinary(&source) ||
      (uintmax_t)source.st_dev != sd || (uintmax_t)source.st_ino != si)
    return receipt(op, "refused", "source", errno);
  if (!strcmp(op, "exchange") &&
      (fstatat(3, argv[3], &target, AT_SYMLINK_NOFOLLOW) || !ordinary(&target) ||
       (uintmax_t)target.st_dev != td || (uintmax_t)target.st_ino != ti))
    return receipt(op, "refused", "target", errno);
  int result;
#ifdef __APPLE__
  unsigned int flags = (!strcmp(op, "exchange") ? RENAME_SWAP : RENAME_EXCL) |
    RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH;
  result = renameatx_np(3, argv[2], 3, argv[3], flags);
#elif defined(__linux__) && defined(SYS_renameat2)
  unsigned int flags = !strcmp(op, "exchange") ? RENAME_EXCHANGE : RENAME_NOREPLACE;
  result = (int)syscall(SYS_renameat2, 3, argv[2], 3, argv[3], flags);
#else
  errno = ENOTSUP; result = -1;
#endif
  if (result) return receipt(op, "refused", "syscall", errno);
  if (fsync(3)) return receipt(op, "partial", "directory-sync", errno);
  return receipt(op, "moved", "synced", 0);
}
`;
