#ifndef AOS_NATIVE_SCAN_CORE_H
#define AOS_NATIVE_SCAN_CORE_H

#include <stddef.h>
#include <sys/stat.h>

#ifdef __cplusplus
extern "C" {
#endif

#define AOS_SCAN_MAX_ATTRIBUTE (32u * 1024u * 1024u)
#define AOS_SCAN_MAX_DEPTH 256u
#define AOS_SCAN_MAX_ENTRIES 1000000u
#define AOS_SCAN_WINDOW 65536u

typedef struct { const unsigned char *data; size_t length; } AosScanBytes;
typedef enum { AOS_SCAN_LINK, AOS_SCAN_ACL, AOS_SCAN_XATTR } AosScanValueKind;
typedef enum {
  AOS_SCAN_ALLOCATION_FAILED, AOS_SCAN_DIRECTORY_UNREADABLE,
  AOS_SCAN_ENTRY_LIMIT, AOS_SCAN_INVENTORY_LIMIT, AOS_SCAN_ENTRY_UNREADABLE,
  AOS_SCAN_CROSS_DEVICE, AOS_SCAN_DATALESS, AOS_SCAN_SOURCE_CHANGED,
  AOS_SCAN_LINK_UNREADABLE, AOS_SCAN_DATA_UNREADABLE,
  AOS_SCAN_ACL_UNREADABLE, AOS_SCAN_XATTRS_UNREADABLE
} AosScanDiagnostic;
typedef struct {
  unsigned pass;
  AosScanBytes path;
  struct stat before;
  const unsigned char *data_sha256;
} AosScanEntry;

/* Borrowed views last only for the call. Nonzero callbacks stop the scan. */
typedef struct {
  void *context;
  int (*entry_begin)(void *, const AosScanEntry *);
  int (*value_begin)(void *, AosScanValueKind, AosScanBytes name,
                     size_t byte_length, const unsigned char *sha256);
  int (*value_bytes)(void *, AosScanBytes);
  int (*value_end)(void *, AosScanValueKind);
  int (*value_unavailable)(void *, AosScanValueKind, AosScanBytes name);
  int (*xattrs_begin)(void *);
  int (*xattrs_end)(void *);
  int (*entry_end)(void *, const struct stat *after);
  int (*diagnostic)(void *, unsigned pass, AosScanBytes path,
                    AosScanDiagnostic, int native_errno);
} AosScanSink;

/* The caller owns and pins root_fd and rechecks its external ancestry. */
int aos_scan_pass(int root_fd, unsigned pass, const AosScanSink *sink);
int aos_scan_stat_equal(const struct stat *, const struct stat *);

#ifdef __cplusplus
}
#endif
#endif
