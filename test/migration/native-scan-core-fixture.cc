#include "../../src/migration/native-inventory/native/scan-core.h"
#include <algorithm>
#include <dirent.h>
#include <fcntl.h>
#include <cstdio>
#include <unistd.h>

struct Capture {
  size_t entries = 0, maximum = 0, expected = 0, seen = 0, fragments = 0;
  bool reject = false;
};
static Capture& capture(void *value) { return *static_cast<Capture *>(value); }
static int begin(void *value, const AosScanEntry *) { capture(value).entries++; return 0; }
static int value_begin(void *value, AosScanValueKind, AosScanBytes, size_t length, const unsigned char *) {
  auto& current = capture(value); current.expected = length; current.seen = 0; return 0;
}
static int value_bytes(void *value, AosScanBytes bytes) {
  auto& current = capture(value);
  current.maximum = std::max(current.maximum, bytes.length);
  current.seen += bytes.length; current.fragments++;
  return current.reject || bytes.length > AOS_SCAN_WINDOW || current.seen > current.expected;
}
static int value_end(void *value, AosScanValueKind) { return capture(value).seen != capture(value).expected; }
static int unavailable(void *, AosScanValueKind, AosScanBytes) { return 0; }
static int boundary(void *) { return 0; }
static int end(void *, const struct stat *after) { return after == nullptr; }
static int diagnostic(void *, unsigned, AosScanBytes, AosScanDiagnostic, int) { return 1; }
static AosScanSink sink(Capture& state) {
  return {&state, begin, value_begin, value_bytes, value_end, unavailable, boundary, boundary, end, diagnostic};
}
static size_t descriptors() {
  DIR *directory = opendir("/dev/fd");
  if (!directory) return 0;
  size_t count = 0;
  while (auto *entry = readdir(directory)) if (entry->d_name[0] != '.') count++;
  closedir(directory); return count;
}
int main(int argc, char **argv) {
  if (argc != 2) return 64;
  int root = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) return 65;
  Capture first, second;
  auto first_sink = sink(first), second_sink = sink(second);
  if (aos_scan_pass(root, 1, &first_sink) || aos_scan_pass(root, 2, &second_sink)) return 1;
  size_t before = descriptors();
  for (unsigned i = 0; i < 16; i++) {
    Capture rejected; rejected.reject = true; auto rejected_sink = sink(rejected);
    if (aos_scan_pass(root, 1, &rejected_sink) != 1) return 2;
  }
  if (!before || descriptors() != before) return 3;
  Capture resumed; auto resumed_sink = sink(resumed);
  if (aos_scan_pass(root, 1, &resumed_sink) || first.entries != second.entries || first.entries != resumed.entries) return 4;
  close(root);
  printf("{\"entries\":%zu,\"maximumWindow\":%zu,\"fragments\":%zu,\"abortCount\":16,\"descriptorCountPreserved\":true}\n", first.entries, first.maximum, first.fragments);
}
