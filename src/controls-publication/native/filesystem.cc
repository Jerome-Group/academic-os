#include "filesystem.hpp"
#include <sys/acl.h>
#include <sys/attr.h>
#include <sys/mount.h>
#include <fcntl.h>
#include <membership.h>
#include <pwd.h>
#include <unistd.h>
#include <uuid/uuid.h>
#include <algorithm>
#include <cerrno>
#include <cstring>
#include <limits>

namespace publication {
namespace {
thread_local std::vector<std::weak_ptr<Handle>> handles;
std::string decimal(uint64_t value) { return std::to_string(value); }
std::string uuidString(const unsigned char* value) {
  char text[37];
  uuid_unparse_lower(value, text);
  return text;
}
Identity identity(int fd, const struct stat& st) {
  struct attrlist attributes = {};
  attributes.bitmapcount = ATTR_BIT_MAP_COUNT;
  attributes.volattr = ATTR_VOL_INFO | ATTR_VOL_UUID;
  struct { uint32_t length; uuid_t uuid; } result = {};
  syscallResult(fgetattrlist(fd, &attributes, &result, sizeof result, 0));
  if (result.length != sizeof result || uuid_is_null(result.uuid)) fail("unsupported-host");
  return {S_ISDIR(st.st_mode) ? "directory" : "regular", uuidString(result.uuid), decimal(st.st_dev), decimal(st.st_ino), decimal(static_cast<uint64_t>(st.st_birthtimespec.tv_sec) * 1000000000 + st.st_birthtimespec.tv_nsec)};
}
std::vector<uint8_t> privateAcl(int fd, bool privateEntry) {
  acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
  if (!acl) {
    if (errno == ENOENT) return {};
    fail("unsupported-host");
  }
  std::unique_ptr<std::remove_pointer_t<acl_t>, decltype(&acl_free)> owned(acl, acl_free);
  uuid_t writer;
  uuid_t root;
  if (mbr_uid_to_uuid(getuid(), writer) || mbr_uid_to_uuid(0, root)) fail("unsupported-host");
  acl_entry_t entry;
  int cursor = ACL_FIRST_ENTRY;
  while (true) {
    int status = acl_get_entry(acl, cursor, &entry);
    if (status == -1) {
      if (errno == EINVAL) break;
      fail("unsupported-host");
    }
    if (status != 0) break;
    cursor = ACL_NEXT_ENTRY;
    acl_tag_t tag;
    acl_permset_t permissions;
    acl_flagset_t flags;
    syscallResult(acl_get_tag_type(entry, &tag));
    syscallResult(acl_get_permset(entry, &permissions));
    syscallResult(acl_get_flagset_np(entry, &flags));
    if (tag == ACL_EXTENDED_DENY || acl_get_flag_np(flags, ACL_ENTRY_ONLY_INHERIT) == 1) continue;
    if (tag != ACL_EXTENDED_ALLOW) fail("unsupported-host");
    void* qualifier = acl_get_qualifier(entry);
    if (!qualifier) fail("unsupported-host");
    bool trusted = uuid_compare(static_cast<unsigned char*>(qualifier), writer) == 0 || uuid_compare(static_cast<unsigned char*>(qualifier), root) == 0;
    acl_free(qualifier);
    if (trusted) continue;
    const acl_perm_t mutation[] = {ACL_WRITE_DATA, ACL_APPEND_DATA, ACL_DELETE, ACL_DELETE_CHILD, ACL_WRITE_ATTRIBUTES, ACL_WRITE_EXTATTRIBUTES, ACL_WRITE_SECURITY, ACL_CHANGE_OWNER};
    for (auto permission : mutation) if (acl_get_perm_np(permissions, permission) != 0) fail("unsafe-ancestry");
    if (privateEntry && (acl_get_perm_np(permissions, ACL_READ_DATA) != 0 || acl_get_perm_np(permissions, ACL_SEARCH) != 0)) fail("unsafe-ancestry");
  }
  ssize_t length = acl_size(acl);
  if (length < 0 || length > 65536) fail("unsupported-host");
  std::vector<uint8_t> bytes(static_cast<size_t>(length));
  if (length && acl_copy_ext_native(bytes.data(), acl, length) != length) fail("unsupported-host");
  return bytes;
}
std::shared_ptr<Handle> remember(int fd, std::shared_ptr<Handle> parent, const std::string& name, bool privateEntry, bool writable, bool directory) {
  auto handle = std::make_shared<Handle>(fd);
  handle->parent = std::move(parent);
  handle->name = name;
  handle->privateEntry = privateEntry;
  handle->writable = writable;
  handle->object = inspectFd(fd, privateEntry, directory).object;
  handles.erase(std::remove_if(handles.begin(), handles.end(), [](const auto& value) { return value.expired(); }), handles.end());
  handles.push_back(handle);
  return handle;
}
std::vector<std::shared_ptr<Handle>> linkedHandlesAt(const std::shared_ptr<Handle>& source) {
  std::vector<std::shared_ptr<Handle>> linked;
  for (const auto& weak : handles) {
    auto handle = weak.lock();
    if (!handle || handle->descriptor.fd < 0 || !handle->parent || !(handle->parent->object == source->parent->object) || !(handle->object == source->object)) continue;
    try { guard(handle); } catch (const Failure&) { continue; }
    linked.push_back(std::move(handle));
  }
  return linked;
}
bool descendant(const std::shared_ptr<Handle>& handle, const std::shared_ptr<Handle>& anchor) {
  for (auto current = handle; current; current = current->parent) if (current == anchor) return true;
  return false;
}
void rejectSidecarDirectory(const std::shared_ptr<Handle>& parent, const std::string& name) {
  std::string folded = name;
  for (auto& byte : folded) if (byte >= 'A' && byte <= 'Z') byte += 'a' - 'A';
  if (folded == "journal-ownership") fail("unsafe-ancestry");
  struct stat candidate, sidecars;
  if (fstatat(parent->descriptor.fd, name.c_str(), &candidate, AT_SYMLINK_NOFOLLOW) == 0 && fstatat(parent->descriptor.fd, "journal-ownership", &sidecars, AT_SYMLINK_NOFOLLOW) == 0 && candidate.st_dev == sidecars.st_dev && candidate.st_ino == sidecars.st_ino) fail("unsafe-ancestry");
}
}
#ifdef AOS_PUBLICATION_FIXTURE_ANCHOR
thread_local std::function<void(const char*)> checkpointHook;
#endif
void checkpoint(const char* edge) {
#ifdef AOS_PUBLICATION_FIXTURE_ANCHOR
  auto hook = checkpointHook;
  if (hook) hook(edge);
#else
  (void)edge;
#endif
}
[[noreturn]] void fail(const char* code) { throw Failure(code); }
void syscallResult(int result) {
  if (result >= 0) return;
  switch (errno) {
    case EEXIST: case ENOTEMPTY: fail("exists");
    case ENOENT: fail("missing");
    case ELOOP: case ENOTDIR: case EACCES: case EPERM: fail("unsafe-ancestry");
    case ENOTSUP: case EXDEV: case EILSEQ: fail("unsupported-host");
    default: fail("io");
  }
}
Descriptor::~Descriptor() { if (fd >= 0) ::close(fd); }
bool Identity::operator==(const Identity& other) const { return kind == other.kind && volume == other.volume && device == other.device && inode == other.inode && birth == other.birth; }
void requireIdentity(const Identity& actual, const Identity& expected) { if (!(actual == expected)) fail("identity-changed"); }
std::string base64(const void* data, size_t length) {
  const auto* bytes = static_cast<const uint8_t*>(data);
  const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string result;
  for (size_t i = 0; i < length; i += 3) {
    unsigned value = static_cast<unsigned>(bytes[i]) << 16;
    if (i + 1 < length) value |= static_cast<unsigned>(bytes[i + 1]) << 8;
    if (i + 2 < length) value |= bytes[i + 2];
    result += alphabet[(value >> 18) & 63]; result += alphabet[(value >> 12) & 63];
    result += i + 1 < length ? alphabet[(value >> 6) & 63] : '=';
    result += i + 2 < length ? alphabet[value & 63] : '=';
  }
  return result;
}
void requireAccount() { if (getuid() == 0 || getuid() != geteuid()) fail("unsupported-host"); }
void component(const std::string& name) { static_assert(NAME_MAX <= 255); if (name.empty() || name == "." || name == ".." || name.size() > NAME_MAX || name.find('/') != std::string::npos || name.find('\0') != std::string::npos) fail("unsafe-ancestry"); }
Identity physicalIdentityFd(int fd) {
  struct stat st;
  syscallResult(fstat(fd, &st));
  if (!S_ISDIR(st.st_mode) && !S_ISREG(st.st_mode)) fail("unsafe-ancestry");
  return identity(fd, st);
}
Observation inspectFd(int fd, bool privateEntry, bool directory) {
  requireAccount();
  struct stat st;
  syscallResult(fstat(fd, &st));
  if (directory ? !S_ISDIR(st.st_mode) : !S_ISREG(st.st_mode)) fail("unsafe-ancestry");
  if (privateEntry) {
    if (st.st_uid != getuid() || (st.st_mode & 07777) != (directory ? 0700 : 0600) || (st.st_flags & ~(UF_HIDDEN | UF_NODUMP | UF_TRACKED))) fail("unsafe-ancestry");
  } else if ((st.st_uid != 0 && st.st_uid != getuid()) || (st.st_mode & 0022)) fail("unsafe-ancestry");
  if (!directory && st.st_nlink != 1) fail("unsafe-ancestry");
  struct statfs filesystem;
  syscallResult(fstatfs(fd, &filesystem));
  if (!(filesystem.f_flags & MNT_LOCAL) || (privateEntry && (filesystem.f_flags & MNT_RDONLY))) fail("unsupported-host");
  auto acl = privateAcl(fd, privateEntry);
  return {identity(fd, st), st, std::move(acl)};
}
Observation guard(const std::shared_ptr<Handle>& handle) {
  checkpoint("before-handle-guard");
  requireAccount();
  if (!handle || handle->descriptor.fd < 0) fail("expired");
  if (handle->parent) {
    guard(handle->parent);
    struct stat entry;
    syscallResult(fstatat(handle->parent->descriptor.fd, handle->name.c_str(), &entry, AT_SYMLINK_NOFOLLOW));
    if (entry.st_dev != static_cast<dev_t>(std::stoull(handle->object.device)) || entry.st_ino != std::stoull(handle->object.inode) || entry.st_birthtimespec.tv_sec < 0 || std::to_string(static_cast<uint64_t>(entry.st_birthtimespec.tv_sec) * 1000000000 + entry.st_birthtimespec.tv_nsec) != handle->object.birth) fail("identity-changed");
  }
  auto observation = inspectFd(handle->descriptor.fd, handle->privateEntry, handle->object.kind == "directory");
  requireIdentity(observation.object, handle->object);
  return observation;
}
std::shared_ptr<Anchor> resolveAnchor() {
  requireAccount();
  size_t length = 16384;
  std::vector<char> bytes(length);
  struct passwd record;
  struct passwd* found = nullptr;
  while (true) {
    int status = getpwuid_r(getuid(), &record, bytes.data(), bytes.size(), &found);
    if (!status && found) break;
    if (status != ERANGE || bytes.size() >= 1048576) fail("unsupported-host");
    bytes.resize(bytes.size() * 2);
  }
  auto anchor = std::make_shared<Anchor>();
  anchor->uid = getuid();
  anchor->home = found->pw_dir;
  anchor->syncHome = anchor->home;
  anchor->path = anchor->home + "/Library/Application Support";
#ifdef AOS_PUBLICATION_FIXTURE_ANCHOR
  anchor->path = AOS_PUBLICATION_FIXTURE_ANCHOR;
  anchor->syncHome = AOS_PUBLICATION_FIXTURE_SYNC_HOME;
#endif
  if (anchor->home.empty() || anchor->home.front() != '/' || anchor->path.front() != '/') fail("unsupported-host");
  uuid_t account, host;
  struct timespec timeout = {2, 0};
  if (mbr_uid_to_uuid(getuid(), account) || gethostuuid(host, &timeout) || uuid_is_null(account) || uuid_is_null(host)) fail("unsupported-host");
  anchor->accountUuid = uuidString(account); anchor->hostUuid = uuidString(host);
  int rootFd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  syscallResult(rootFd);
  auto current = remember(rootFd, nullptr, "", false, false, true);
  size_t start = 1;
  while (start < anchor->path.size()) {
    size_t end = anchor->path.find('/', start);
    std::string name = anchor->path.substr(start, end - start);
    component(name);
    int fd = openat(current->descriptor.fd, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    syscallResult(fd);
    bool last = end == std::string::npos;
    current = remember(fd, current, name, last, false, true);
    if (last) break;
    start = end + 1;
  }
  anchor->directory = current;
  guard(current);
  char canonical[PATH_MAX];
  syscallResult(fcntl(current->descriptor.fd, F_GETPATH, canonical));
  if (anchor->path != canonical) fail("unsafe-ancestry");
  return anchor;
}
std::shared_ptr<Handle> openChild(const std::shared_ptr<Handle>& parent, const std::string& name, bool directory, bool writable) {
  component(name); guard(parent); rejectSidecarDirectory(parent, name);
  struct stat before;
  syscallResult(fstatat(parent->descriptor.fd, name.c_str(), &before, AT_SYMLINK_NOFOLLOW));
  if (directory ? !S_ISDIR(before.st_mode) : (!S_ISREG(before.st_mode) || before.st_nlink != 1)) fail("unsafe-ancestry");
  int flags = (writable ? O_RDWR : O_RDONLY) | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK;
  if (directory) flags |= O_DIRECTORY;
  int fd = openat(parent->descriptor.fd, name.c_str(), flags);
  syscallResult(fd);
  auto handle = remember(fd, parent, name, true, writable, directory);
  guard(handle);
  return handle;
}
void guardInterval(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& handle) {
  if (!interval || !interval->active) fail("expired");
  if (!descendant(handle, interval->anchor->directory)) fail("unsafe-ancestry");
  guard(handle);
  recheckExclusions(interval->anchor);
}
std::shared_ptr<Handle> createChild(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& parent, const std::string& name, bool directory) {
  component(name); guardInterval(interval, parent); rejectSidecarDirectory(parent, name);
  if (directory) {
    checkpoint("before-create-directory");
    syscallResult(mkdirat(parent->descriptor.fd, name.c_str(), 0700));
    auto handle = openChild(parent, name, true, false);
    checkpoint("after-create-directory");
    return handle;
  }
  checkpoint("before-create-regular");
  int fd = openat(parent->descriptor.fd, name.c_str(), O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600);
  syscallResult(fd);
  auto handle = remember(fd, parent, name, true, true, false);
  guard(handle);
  checkpoint("after-create-regular");
  return handle;
}
uint64_t maximumFileOffset() {
  return std::min({uint64_t{9007199254740991}, static_cast<uint64_t>(std::numeric_limits<size_t>::max()), static_cast<uint64_t>(std::numeric_limits<off_t>::max())});
}
size_t checkedLength(off_t length) {
  if (length < 0 || static_cast<uint64_t>(length) > maximumFileOffset()) fail("unsafe-ancestry");
  return static_cast<size_t>(length);
}
size_t checkedEnd(size_t offset, size_t length) {
  if (offset > maximumFileOffset() || length > maximumFileOffset() - offset) fail("unsafe-ancestry");
  return offset + length;
}
bool sameSnapshot(const Observation& a, const Observation& b) {
  return a.object == b.object && a.stat.st_size == b.stat.st_size &&
    a.stat.st_mtimespec.tv_sec == b.stat.st_mtimespec.tv_sec && a.stat.st_mtimespec.tv_nsec == b.stat.st_mtimespec.tv_nsec &&
    a.stat.st_ctimespec.tv_sec == b.stat.st_ctimespec.tv_sec && a.stat.st_ctimespec.tv_nsec == b.stat.st_ctimespec.tv_nsec;
}
std::shared_ptr<LedgerReadSnapshot> startLedgerRead(const std::shared_ptr<Handle>& file) {
  auto initial = guard(file);
  if (file->object.kind != "regular") fail("unsafe-ancestry");
  auto result = std::make_shared<LedgerReadSnapshot>();
  result->file = file;
  for (auto current = file; current && current->parent; current = current->parent) result->linkage.emplace_back(current->parent->object, current->name);
  result->totalLength = checkedLength(initial.stat.st_size);
  result->initial = std::move(initial);
  return result;
}
Observation guardSnapshot(const std::shared_ptr<LedgerReadSnapshot>& snapshot, const std::shared_ptr<Handle>& file) {
  auto observed = guard(file);
  size_t index = 0;
  for (auto current = file; current && current->parent; current = current->parent) {
    if (index >= snapshot->linkage.size() || !(snapshot->linkage[index].first == current->parent->object) || snapshot->linkage[index].second != current->name) fail("identity-changed");
    index++;
  }
  if (index != snapshot->linkage.size() || !sameSnapshot(snapshot->initial, observed)) fail("identity-changed");
  return observed;
}
std::vector<uint8_t> readLedgerWindow(const std::shared_ptr<LedgerReadSnapshot>& snapshot, const std::shared_ptr<Handle>& file, size_t offset) {
  if (snapshot->file != file || snapshot->finished || offset != snapshot->nextOffset || offset > snapshot->totalLength) fail("unsafe-ancestry");
  guardSnapshot(snapshot, file);
  size_t length = std::min(ledgerReadWindow, snapshot->totalLength - offset);
  size_t end = checkedEnd(offset, length);
  std::vector<uint8_t> bytes(length);
  checkpoint("before-read");
  if (length) {
    ssize_t count;
    do { count = pread(file->descriptor.fd, bytes.data(), length, static_cast<off_t>(offset)); } while (count < 0 && errno == EINTR);
    if (count < 0 || static_cast<size_t>(count) != length) fail("io");
  }
  checkpoint("after-read");
  guardSnapshot(snapshot, file);
  snapshot->nextOffset = end;
  snapshot->finished = end == snapshot->totalLength;
  return bytes;
}
std::vector<uint8_t> readExact(const std::shared_ptr<Handle>& handle, size_t maximum, size_t length) {
  auto before = guard(handle);
  if (handle->object.kind != "regular" || maximum > maximumBytes || length > maximum || checkedLength(before.stat.st_size) != length) fail("identity-changed");
  std::vector<uint8_t> bytes(length);
  size_t offset = 0;
  while (offset < length) {
    checkpoint("before-read");
    ssize_t count = pread(handle->descriptor.fd, bytes.data() + offset, length - offset, offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) fail("io");
    offset += static_cast<size_t>(count);
  }
  checkpoint("after-read");
  auto after = guard(handle);
  if (!sameSnapshot(before, after)) fail("identity-changed");
  return bytes;
}
void writeExact(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& handle, const std::vector<uint8_t>& bytes, const Identity& expected, bool append, size_t expectedLength) {
  guardInterval(interval, handle);
  requireIdentity(handle->object, expected);
  if (!handle->writable || handle->object.kind != "regular" || bytes.size() > maximumBytes) fail("unsafe-ancestry");
  auto before = guard(handle);
  size_t end = checkedEnd(append ? expectedLength : 0, bytes.size());
  if (append && checkedLength(before.stat.st_size) != expectedLength) fail("identity-changed");
  size_t offset = 0;
  while (offset < bytes.size()) {
    checkpoint("before-write");
    ssize_t count = pwrite(handle->descriptor.fd, bytes.data() + offset, bytes.size() - offset, static_cast<off_t>(checkedEnd(append ? expectedLength : 0, offset)));
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) fail("io");
    offset += static_cast<size_t>(count);
  }
  checkpoint("after-write");
  if (!append) {
    checkpoint("before-truncate");
    int result;
    do { result = ftruncate(handle->descriptor.fd, static_cast<off_t>(end)); } while (result < 0 && errno == EINTR);
    syscallResult(result);
    checkpoint("after-truncate");
  }
  auto after = guard(handle);
  if (checkedLength(after.stat.st_size) != end) fail("identity-changed");
}
void sync(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& handle) {
  guardInterval(interval, handle);
  checkpoint(handle->object.kind == "directory" ? "before-directory-sync" : "before-file-sync");
  int result;
  do { result = fsync(handle->descriptor.fd); } while (result < 0 && errno == EINTR);
  syscallResult(result);
  checkpoint(handle->object.kind == "directory" ? "after-directory-sync" : "after-file-sync");
  guard(handle);
}
void promote(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& sourceParent, const std::string& sourceName, const std::shared_ptr<Handle>& destinationParent, const std::string& destinationName, const Identity& expected, bool exclusive) {
  component(sourceName); component(destinationName);
  guardInterval(interval, sourceParent); guardInterval(interval, destinationParent);
  rejectSidecarDirectory(sourceParent, sourceName); rejectSidecarDirectory(destinationParent, destinationName);
  auto source = openChild(sourceParent, sourceName, expected.kind == "directory", false);
  requireIdentity(source->object, expected);
  auto linked = linkedHandlesAt(source);
  checkpoint("before-exclusive-promote");
  syscallResult(renameatx_np(sourceParent->descriptor.fd, sourceName.c_str(), destinationParent->descriptor.fd, destinationName.c_str(), exclusive ? RENAME_EXCL : 0));
  for (const auto& handle : linked) {
    handle->parent = destinationParent; handle->name = destinationName;
  }
  checkpoint("after-exclusive-promote");
  guard(source);
}
void replaceHead(const std::shared_ptr<Interval>& interval, const std::shared_ptr<Handle>& parent, const std::string& temporaryName, const Identity& temporaryObject, const std::string& headName, const Identity* oldObject, const std::vector<uint8_t>& oldBytes) {
  component(temporaryName); component(headName);
  if (temporaryObject.kind != "regular" || temporaryName == headName) fail("unsafe-ancestry");
  guardInterval(interval, parent);
  rejectSidecarDirectory(parent, temporaryName); rejectSidecarDirectory(parent, headName);
  auto temporary = openChild(parent, temporaryName, false, false);
  requireIdentity(temporary->object, temporaryObject);
  if (oldObject) {
    auto old = openChild(parent, headName, false, false);
    requireIdentity(old->object, *oldObject);
    if (readExact(old, maximumBytes, oldBytes.size()) != oldBytes) fail("identity-changed");
  } else {
    struct stat entry;
    if (fstatat(parent->descriptor.fd, headName.c_str(), &entry, AT_SYMLINK_NOFOLLOW) == 0) fail("exists");
    if (errno != ENOENT) syscallResult(-1);
  }
  auto linked = linkedHandlesAt(temporary);
  checkpoint("before-head-rename");
  syscallResult(renameatx_np(parent->descriptor.fd, temporaryName.c_str(), parent->descriptor.fd, headName.c_str(), oldObject ? 0 : RENAME_EXCL));
  for (const auto& handle : linked) {
    handle->parent = parent; handle->name = headName;
  }
  checkpoint("after-head-rename");
  guard(temporary);
}
void closeHandle(const std::shared_ptr<Handle>& handle) {
  if (handle->descriptor.fd < 0) return;
  int fd = handle->descriptor.fd;
  handle->descriptor.fd = -1;
  handle->parent.reset();
  syscallResult(::close(fd));
}
}
