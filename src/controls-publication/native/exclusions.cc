#include "filesystem.hpp"
#include <CoreFoundation/CoreFoundation.h>
#include <sys/mount.h>
#include <sys/attr.h>
#include <CommonCrypto/CommonDigest.h>
#include <optional>
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
struct ForbiddenStorage {
  std::vector<struct stat> objects;
  void reject(const struct stat& candidate) const {
    for (const auto& object : objects) if (candidate.st_dev == object.st_dev && candidate.st_ino == object.st_ino && candidate.st_birthtimespec.tv_sec == object.st_birthtimespec.tv_sec && candidate.st_birthtimespec.tv_nsec == object.st_birthtimespec.tv_nsec) fail("unsafe-ancestry");
  }
};
ForbiddenStorage sidecarStorage(const std::shared_ptr<Anchor>& anchor) {
  ForbiddenStorage result;
  struct stat directory;
  if (fstatat(anchor->directory->descriptor.fd, "journal-ownership", &directory, AT_SYMLINK_NOFOLLOW) < 0) {
    if (errno == ENOENT) return result;
    syscallResult(-1);
  }
  if (!S_ISDIR(directory.st_mode)) fail("unsafe-ancestry");
  result.objects.push_back(directory);
  int fd = openat(anchor->directory->descriptor.fd, "journal-ownership", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  syscallResult(fd);
  Descriptor owned(fd);
  auto observed = inspectFd(fd, true, true);
  if (observed.stat.st_dev != directory.st_dev || observed.stat.st_ino != directory.st_ino) fail("identity-changed");
  const std::string journal = anchor->path + "/academic-os-control-publication.jsonl";
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(journal.data(), static_cast<CC_LONG>(journal.size()), digest);
  std::string key;
  const char hex[] = "0123456789abcdef";
  for (auto byte : digest) { key += hex[byte >> 4]; key += hex[byte & 15]; }
  key += ".sqlite";
  for (const char* suffix : {"", "-journal", "-wal", "-shm"}) {
    struct stat sidecar;
    if (fstatat(fd, (key + suffix).c_str(), &sidecar, AT_SYMLINK_NOFOLLOW) == 0) result.objects.push_back(sidecar);
    else if (errno != ENOENT) syscallResult(-1);
  }
  return result;
}
PathSnapshot snapshot(const std::string& path, bool optional, const ForbiddenStorage& forbidden, unsigned depth = 0);
std::string aliasDestination(const std::string& path, const ForbiddenStorage& forbidden, unsigned depth) {
  CFURLRef file = CFURLCreateFromFileSystemRepresentation(nullptr, reinterpret_cast<const UInt8*>(path.data()), path.size(), false);
  if (!file) fail("unsupported-host");
  CFErrorRef error = nullptr;
  CFDataRef bookmark = CFURLCreateBookmarkDataFromFile(nullptr, file, &error);
  CFRelease(file);
  if (error) CFRelease(error);
  if (!bookmark) fail("unsupported-host");
  auto owned = std::unique_ptr<const __CFData, decltype(&CFRelease)>(bookmark, CFRelease);
  CFTypeRef directory = CFURLCreateResourcePropertyForKeyFromBookmarkData(nullptr, kCFURLIsDirectoryKey, bookmark);
  bool isDirectory = directory && CFGetTypeID(directory) == CFBooleanGetTypeID() && CFBooleanGetValue(static_cast<CFBooleanRef>(directory));
  if (directory) CFRelease(directory);
  if (!isDirectory) fail("unsupported-host");
  CFTypeRef storedPath = CFURLCreateResourcePropertyForKeyFromBookmarkData(nullptr, kCFURLPathKey, bookmark);
  UInt8 raw[PATH_MAX];
  bool pathOkay = storedPath && CFGetTypeID(storedPath) == CFStringGetTypeID() && CFStringGetFileSystemRepresentation(static_cast<CFStringRef>(storedPath), reinterpret_cast<char*>(raw), sizeof raw);
  if (storedPath) CFRelease(storedPath);
  if (!pathOkay) fail("unsupported-host");
  auto target = snapshot(reinterpret_cast<const char*>(raw), false, forbidden, depth);
  CFURLRef targetURL = CFURLCreateFromFileSystemRepresentation(nullptr, reinterpret_cast<const UInt8*>(target.resolved.data()), target.resolved.size(), true);
  if (!targetURL) fail("unsupported-host");
  auto ownedURL = std::unique_ptr<const __CFURL, decltype(&CFRelease)>(targetURL, CFRelease);
  for (auto key : {kCFURLFileResourceIdentifierKey, kCFURLVolumeUUIDStringKey}) {
    CFTypeRef expected = CFURLCreateResourcePropertyForKeyFromBookmarkData(nullptr, key, bookmark), actual = nullptr;
    error = nullptr;
    bool read = CFURLCopyResourcePropertyForKey(targetURL, key, &actual, &error);
    bool same = read && expected && actual && CFEqual(expected, actual);
    if (error) CFRelease(error);
    if (expected) CFRelease(expected);
    if (actual) CFRelease(actual);
    if (!same) fail("unsupported-host");
  }
  return target.resolved;
}
PathSnapshot snapshot(const std::string& path, bool optional, const ForbiddenStorage& forbidden, unsigned depth) {
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
    forbidden.reject(before);
    result.signature += ":" + std::to_string(before.st_dev) + ":" + std::to_string(before.st_ino) + ":" + std::to_string(before.st_birthtimespec.tv_sec) + ":" + std::to_string(before.st_birthtimespec.tv_nsec) + ":" + std::to_string(before.st_mode);
    if (S_ISLNK(before.st_mode)) {
      if (++links + depth > 32) fail("unsafe-ancestry");
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
      if (++links + depth > 32) fail("unsafe-ancestry");
      struct attrlist attributes = {};
      attributes.bitmapcount = ATTR_BIT_MAP_COUNT;
      attributes.commonattr = ATTR_CMN_FNDRINFO;
      struct { uint32_t length; uint8_t finder[32]; } information = {};
      syscallResult(getattrlistat(parent, name.c_str(), &attributes, &information, sizeof information, FSOPT_NOFOLLOW));
      if (information.length != sizeof information || !(information.finder[8] & 0x80) || before.st_size <= 0) fail("unsupported-host");
      std::string target = aliasDestination(descriptorPath(parent) + "/" + name, forbidden, depth + links);
      struct stat after;
      syscallResult(fstatat(parent, name.c_str(), &after, AT_SYMLINK_NOFOLLOW));
      if (before.st_dev != after.st_dev || before.st_ino != after.st_ino || before.st_mtimespec.tv_sec != after.st_mtimespec.tv_sec || before.st_mtimespec.tv_nsec != after.st_mtimespec.tv_nsec) fail("identity-changed");
      if (!visited.insert(std::to_string(before.st_dev) + ":" + std::to_string(before.st_ino) + ":" + std::to_string(before.st_birthtimespec.tv_sec) + ":" + std::to_string(before.st_birthtimespec.tv_nsec)).second) fail("unsafe-ancestry");
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
  result.resolved = descriptorPath(chain.back()->fd);
  result.signature += "resolved:" + identityText(result.ancestry.back());
  return result;
}
std::string cloudChildren(const std::string& home, const ForbiddenStorage& forbidden) {
  auto cloud = snapshot(home + "/Library/CloudStorage", true, forbidden);
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
  auto forbidden = sidecarStorage(anchor);
  for (const auto& path : required) result->paths.push_back(snapshot(path, false, forbidden));
  const char* known[] = {"/Library/CloudStorage", "/Library/Mobile Documents", "/Dropbox", "/OneDrive", "/Google Drive", "/Box Sync", "/iCloud Drive"};
  for (auto suffix : known) result->paths.push_back(snapshot(anchor->syncHome + suffix, true, forbidden));
  result->cloudChildren = cloudChildren(anchor->syncHome, forbidden);
  nonoverlap(anchor, *result);
  anchor->exclusions = result;
  return result;
}
void recheckExclusions(const std::shared_ptr<Anchor>& anchor) {
  if (!anchor->exclusions) fail("unsafe-ancestry");
  auto forbidden = sidecarStorage(anchor);
  for (const auto& path : anchor->exclusions->paths) {
    auto fresh = snapshot(path.path, path.optional, forbidden);
    if (fresh.signature != path.signature || fresh.absent != path.absent) fail("identity-changed");
  }
  if (cloudChildren(anchor->syncHome, forbidden) != anchor->exclusions->cloudChildren) fail("identity-changed");
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
