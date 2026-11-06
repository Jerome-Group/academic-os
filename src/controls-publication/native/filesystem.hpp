#pragma once
#include <sys/stat.h>
#include <array>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef AOS_PUBLICATION_FIXTURE_ANCHOR
#include <functional>
#endif

namespace publication {
struct Failure : std::runtime_error {
  std::string code;
  explicit Failure(std::string code) : std::runtime_error(code), code(std::move(code)) {}
};
void checkpoint(const char* edge);
#ifdef AOS_PUBLICATION_FIXTURE_ANCHOR
extern thread_local std::function<void(const char*)> checkpointHook;
#endif
[[noreturn]] void fail(const char* code);
void syscallResult(int result);
struct Descriptor {
  int fd = -1;
  explicit Descriptor(int fd = -1) : fd(fd) {}
  ~Descriptor();
  Descriptor(const Descriptor&) = delete;
  Descriptor& operator=(const Descriptor&) = delete;
};
struct Identity {
  std::string kind, volume, device, inode, birth;
  bool operator==(const Identity& other) const;
};
struct Observation {
  Identity object;
  struct stat stat;
  std::vector<uint8_t> acl;
};
struct Handle {
  Descriptor descriptor;
  Identity object;
  std::shared_ptr<Handle> parent;
  std::string name;
  bool privateEntry = true;
  bool writable = false;
  explicit Handle(int fd) : descriptor(fd) {}
};
struct PathSnapshot {
  std::string path, signature, resolved;
  bool optional = false;
  bool absent = false;
  std::vector<Identity> ancestry;
};
struct Exclusions {
  std::vector<PathSnapshot> paths;
  std::string cloudChildren;
};
struct Anchor {
  std::shared_ptr<Handle> directory;
  std::string path, home, syncHome, accountUuid, hostUuid;
  uid_t uid;
  std::shared_ptr<Exclusions> exclusions;
};
struct Interval {
  std::shared_ptr<Anchor> anchor;
  bool active = true;
};
struct LedgerReadSnapshot {
  std::shared_ptr<Handle> file;
  Observation initial;
  std::vector<std::pair<Identity, std::string>> linkage;
  size_t totalLength;
  size_t nextOffset = 0;
  bool finished = false;
  void* environment = nullptr;
};
constexpr size_t maximumBytes = 64 * 1024 * 1024;
constexpr size_t ledgerReadWindow = 64 * 1024;
uint64_t maximumFileOffset();
size_t checkedLength(off_t length);
size_t checkedEnd(size_t offset, size_t length);
std::shared_ptr<LedgerReadSnapshot> startLedgerRead(const std::shared_ptr<Handle>& file);
std::vector<uint8_t> readLedgerWindow(const std::shared_ptr<LedgerReadSnapshot>& snapshot, const std::shared_ptr<Handle>& file, size_t offset);
std::string base64(const void* bytes, size_t length);
void requireAccount();
void component(const std::string& value);
Identity physicalIdentityFd(int fd);
Observation inspectFd(int fd, bool privateEntry, bool directory);
Observation guard(const std::shared_ptr<Handle>& handle);
std::shared_ptr<Anchor> resolveAnchor();
std::shared_ptr<Handle> openChild(const std::shared_ptr<Handle>& parent, const std::string& name, bool directory, bool writable);
std::shared_ptr<Handle> createChild(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& parent, const std::string& name, bool directory);
void guardInterval(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& handle);
void requireIdentity(const Identity& actual, const Identity& expected);
std::vector<uint8_t> readExact(const std::shared_ptr<Handle>& handle, size_t maximum, size_t length);
void writeExact(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& handle, const std::vector<uint8_t>& bytes, const Identity& expected, bool append, size_t expectedLength);
void sync(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& handle);
void replaceHead(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& parent, const std::string& temporaryName, const Identity& temporaryObject, const std::string& headName, const Identity* oldObject, const std::vector<uint8_t>& oldBytes);
void promote(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& sourceParent, const std::string& sourceName, const std::shared_ptr<Handle>& destinationParent, const std::string& destinationName, const Identity& expected, bool exclusive);
void closeHandle(const std::shared_ptr<Handle>& handle);
std::shared_ptr<Exclusions> observeExclusions(const std::shared_ptr<Anchor>& anchor, const std::vector<std::string>& required);
void requireNonoverlap(const std::shared_ptr<Anchor>& anchor, const std::shared_ptr<Handle>& nameSpace, const std::shared_ptr<Exclusions>& exclusions);
void recheckExclusions(const std::shared_ptr<Anchor>& anchor);
}
