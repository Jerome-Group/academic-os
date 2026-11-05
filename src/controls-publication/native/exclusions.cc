#include "filesystem.hpp"
#include <CoreFoundation/CoreFoundation.h>
#include <sys/mount.h>
#include <sys/xattr.h>
#include <dirent.h>
#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <deque>
#include <set>

namespace publication {
namespace {
std::string identityText(const Identity& object) { return object.kind + ":" + object.volume + ":" + object.device + ":" + object.inode + ":" + object.birth; }
std::deque<std::string> parts(const std::string& path) {
  std::deque<std::string> result;
  size_t start = 0;
  while (start <= path.size()) {
    size_t end = path.find('/', start);
    std::string name = path.substr(start, end - start);
    if (!name.empty() && name != ".") result.push_back(name);
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return result;
}
std::string descriptorPath(int fd) {
  char path[PATH_MAX];
  syscallResult(fcntl(fd, F_GETPATH, path));
  return path;
}
std::string aliasDestination(const std::string& path) {
  CFURLRef file = CFURLCreateFromFileSystemRepresentation(nullptr, reinterpret_cast<const UInt8*>(path.data()), path.size(), false);
  if (!file) fail("unsupported-host");
  CFErrorRef error = nullptr;
  CFDataRef bookmark = CFURLCreateBookmarkDataFromFile(nullptr, file, &error);
  CFRelease(file);
  if (error) CFRelease(error);
  if (!bookmark) fail("unsupported-host");
  Boolean stale = false;
  CFURLRef resolved = CFURLCreateByResolvingBookmarkData(nullptr, bookmark, kCFURLBookmarkResolutionWithoutUIMask | kCFURLBookmarkResolutionWithoutMountingMask, nullptr, nullptr, &stale, &error);
  CFRelease(bookmark);
  if (error) CFRelease(error);
  if (!resolved || stale) { if (resolved) CFRelease(resolved); fail("unsupported-host"); }
  UInt8 raw[PATH_MAX];
  bool result = CFURLGetFileSystemRepresentation(resolved, true, raw, sizeof raw);
  CFRelease(resolved);
  if (!result) fail("unsupported-host");
  return reinterpret_cast<const char*>(raw);
}
PathSnapshot snapshot(const std::string& path, bool optional) {
  if (path.empty() || path.front() != '/' || path.size() >= PATH_MAX || path.find('\0') != std::string::npos) fail("unsafe-ancestry");
  PathSnapshot result;
  result.path = path; result.optional = optional;
  auto pending = parts(path);
  std::vector<std::shared_ptr<Descriptor>> chain;
  auto reset = [&] {
    int fd = open("/", O_RDONLY | O_NOFOLLOW | O_DIRECTORY | O_CLOEXEC);
    syscallResult(fd);
    chain.clear(); chain.push_back(std::make_shared<Descriptor>(fd));
    result.ancestry = {physicalIdentityFd(fd)};
  };
  reset();
  unsigned links = 0;
  std::set<std::string> visited;
  while (!pending.empty()) {
    std::string name = pending.front(); pending.pop_front();
    if (name == "..") {
      if (chain.size() > 1) { chain.pop_back(); result.ancestry.pop_back(); }
      continue;
    }
    component(name);
    int parent = chain.back()->fd;
    struct stat before;
    if (fstatat(parent, name.c_str(), &before, AT_SYMLINK_NOFOLLOW) < 0) {
      if (errno != ENOENT || !optional) syscallResult(-1);
      result.absent = true;
      result.signature += "absent:" + identityText(physicalIdentityFd(parent)) + ":" + base64(name.data(), name.size());
      for (const auto& suffix : pending) result.signature += "/" + base64(suffix.data(), suffix.size());
      return result;
    }
    result.signature += ":" + std::to_string(before.st_dev) + ":" + std::to_string(before.st_ino) + ":" + std::to_string(before.st_birthtimespec.tv_sec) + ":" + std::to_string(before.st_birthtimespec.tv_nsec) + ":" + std::to_string(before.st_mode);
    if (S_ISLNK(before.st_mode)) {
      if (++links > 32) fail("unsafe-ancestry");
      char raw[PATH_MAX];
      ssize_t length = readlinkat(parent, name.c_str(), raw, sizeof raw);
      if (length < 0) syscallResult(-1);
      if (length == 0 || length >= PATH_MAX) fail("unsupported-host");
      std::string target(raw, length);
      std::string marker = std::to_string(before.st_dev) + ":" + std::to_string(before.st_ino) + ":" + target;
      if (!visited.insert(marker).second) fail("unsafe-ancestry");
      struct stat after;
      syscallResult(fstatat(parent, name.c_str(), &after, AT_SYMLINK_NOFOLLOW));
      if (before.st_dev != after.st_dev || before.st_ino != after.st_ino || before.st_mtimespec.tv_sec != after.st_mtimespec.tv_sec || before.st_mtimespec.tv_nsec != after.st_mtimespec.tv_nsec) fail("identity-changed");
      result.signature += "link:" + base64(target.data(), target.size());
      auto replacement = parts(target);
      if (target.front() == '/') reset();
      pending.insert(pending.begin(), replacement.begin(), replacement.end());
      continue;
    }
    if (S_ISREG(before.st_mode)) {
      if (++links > 32) fail("unsafe-ancestry");
      int fd = openat(parent, name.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
      syscallResult(fd);
      Descriptor alias(fd);
      auto object = physicalIdentityFd(fd);
      if (object.device != std::to_string(before.st_dev) || object.inode != std::to_string(before.st_ino)) fail("identity-changed");
      uint8_t finder[32];
      ssize_t count = fgetxattr(fd, "com.apple.FinderInfo", finder, sizeof finder, 0, 0);
      if (count != 32 || !(finder[8] & 0x80)) fail("unsupported-host");
      std::string target = aliasDestination(descriptorPath(parent) + "/" + name);
      struct stat after;
      syscallResult(fstatat(parent, name.c_str(), &after, AT_SYMLINK_NOFOLLOW));
      if (before.st_dev != after.st_dev || before.st_ino != after.st_ino || before.st_mtimespec.tv_sec != after.st_mtimespec.tv_sec || before.st_mtimespec.tv_nsec != after.st_mtimespec.tv_nsec) fail("identity-changed");
      if (!visited.insert(identityText(object)).second) fail("unsafe-ancestry");
      result.signature += "alias:" + base64(target.data(), target.size());
      auto replacement = parts(target);
      reset();
      pending.insert(pending.begin(), replacement.begin(), replacement.end());
      continue;
    }
    if (!S_ISDIR(before.st_mode)) fail("unsupported-host");
    int fd = openat(parent, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    syscallResult(fd);
    auto entry = std::make_shared<Descriptor>(fd);
    auto object = physicalIdentityFd(fd);
    if (object.device != std::to_string(before.st_dev) || object.inode != std::to_string(before.st_ino)) fail("identity-changed");
    chain.push_back(entry); result.ancestry.push_back(object);
  }
  struct statfs filesystem;
  syscallResult(fstatfs(chain.back()->fd, &filesystem));
  if (!(filesystem.f_flags & MNT_LOCAL)) fail("unsupported-host");
  result.signature += "resolved:" + identityText(result.ancestry.back());
  return result;
}
std::string cloudChildren(const std::string& home) {
  auto cloud = snapshot(home + "/Library/CloudStorage", true);
  if (cloud.absent) return "absent";
  std::string path = home + "/Library/CloudStorage";
  int fd = open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  syscallResult(fd);
  if (!(physicalIdentityFd(fd) == cloud.ancestry.back())) { ::close(fd); fail("identity-changed"); }
  DIR* directory = fdopendir(fd);
  if (!directory) { ::close(fd); fail("io"); }
  std::unique_ptr<DIR, decltype(&closedir)> owned(directory, closedir);
  std::vector<std::string> names;
  errno = 0;
  while (auto* entry = readdir(directory)) {
    std::string name = entry->d_name;
    if (name == "." || name == ".." || name == ".DS_Store") continue;
    if (name.rfind("GoogleDrive-", 0) != 0 && name.rfind("OneDrive-", 0) != 0 && name != "Dropbox" && name.rfind("Dropbox-", 0) != 0 && name.rfind("Box-", 0) != 0) fail("unsupported-host");
    names.push_back(name);
  }
  if (errno) fail("io");
  std::sort(names.begin(), names.end());
  std::string result;
  for (const auto& name : names) result += base64(name.data(), name.size()) + ":";
  return result;
}
void nonoverlap(const std::shared_ptr<Anchor>& anchor, const Exclusions& exclusions) {
  std::vector<Identity> ancestry;
  for (auto handle = anchor->directory; handle; handle = handle->parent) ancestry.push_back(handle->object);
  for (const auto& path : exclusions.paths) {
    if (path.absent) continue;
    for (const auto& ancestor : path.ancestry) if (ancestor == anchor->directory->object) fail("unsafe-ancestry");
    for (const auto& ancestor : ancestry) if (ancestor == path.ancestry.back()) fail("unsafe-ancestry");
  }
}
}
std::shared_ptr<Exclusions> observeExclusions(const std::shared_ptr<Anchor>& anchor, const std::vector<std::string>& required) {
  guard(anchor->directory);
  if (required.empty() || required.size() > 64) fail("unsafe-ancestry");
  auto result = std::make_shared<Exclusions>();
  for (const auto& path : required) result->paths.push_back(snapshot(path, false));
  const char* known[] = {"/Library/CloudStorage", "/Library/Mobile Documents", "/Dropbox", "/OneDrive", "/Google Drive", "/Box Sync", "/iCloud Drive"};
  for (auto suffix : known) result->paths.push_back(snapshot(anchor->syncHome + suffix, true));
  result->cloudChildren = cloudChildren(anchor->syncHome);
  nonoverlap(anchor, *result);
  anchor->exclusions = result;
  return result;
}
void recheckExclusions(const std::shared_ptr<Anchor>& anchor) {
  if (!anchor->exclusions) fail("unsafe-ancestry");
  for (const auto& path : anchor->exclusions->paths) {
    auto fresh = snapshot(path.path, path.optional);
    if (fresh.signature != path.signature || fresh.absent != path.absent) fail("identity-changed");
  }
  if (cloudChildren(anchor->syncHome) != anchor->exclusions->cloudChildren) fail("identity-changed");
  nonoverlap(anchor, *anchor->exclusions);
}
void requireNonoverlap(const std::shared_ptr<Anchor>& anchor, const std::shared_ptr<Handle>& nameSpace, const std::shared_ptr<Exclusions>& exclusions) {
  guard(anchor->directory); guard(nameSpace);
  if (anchor->exclusions != exclusions) fail("identity-changed");
  bool nested = false;
  for (auto current = nameSpace; current; current = current->parent) if (current == anchor->directory) nested = true;
  if (!nested || !nameSpace->privateEntry) fail("unsafe-ancestry");
  recheckExclusions(anchor);
}
}
