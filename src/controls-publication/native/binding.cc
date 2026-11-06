#include "filesystem.hpp"
#include <node_api.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cmath>
#include <cstring>
#include <functional>
#include <limits>
#include <optional>

namespace {
using namespace publication;
const napi_type_tag snapshotTag = {0x195f286931f553ac, 0xf448ecc510701abc};
const napi_type_tag handleTag = {0x70344282929d11a4, 0x923abd139729b2d1};
const napi_type_tag nameTag = {0x38498c72382914a2, 0x823a34ae4d894db7};
const napi_type_tag anchorTag = {0x0982bce284292dba, 0xcaf5427938a49f2b};
const napi_type_tag intervalTag = {0x2e49e2ddf289931a, 0xeacb349287a43f93};
const napi_type_tag exclusionsTag = {0x894729a1e38fbaac, 0xfead192312e7baca};
void check(napi_status status) { if (status != napi_ok) fail("unsafe-ancestry"); }
napi_value object(napi_env env) { napi_value value; check(napi_create_object(env, &value)); return value; }
napi_value undefined(napi_env env) { napi_value value; check(napi_get_undefined(env, &value)); return value; }
napi_value text(napi_env env, const std::string& value) { napi_value result; check(napi_create_string_utf8(env, value.data(), value.size(), &result)); return result; }
napi_value number(napi_env env, uint64_t value) { napi_value result; check(napi_create_double(env, static_cast<double>(value), &result)); return result; }
void put(napi_env env, napi_value value, const char* name, napi_value property) { check(napi_set_named_property(env, value, name, property)); }
napi_value get(napi_env env, napi_value value, const char* name) { napi_value result; check(napi_get_named_property(env, value, name, &result)); return result; }
std::string string(napi_env env, napi_value value) {
  size_t length;
  check(napi_get_value_string_utf8(env, value, nullptr, 0, &length));
  if (length > PATH_MAX * 2) fail("unsafe-ancestry");
  std::vector<char> bytes(length + 1);
  check(napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &length));
  return std::string(bytes.data(), length);
}
size_t offset(napi_env env, napi_value value) {
  double result;
  check(napi_get_value_double(env, value, &result));
  if (!std::isfinite(result) || result < 0 || std::floor(result) != result || result > static_cast<double>(maximumFileOffset())) fail("unsafe-ancestry");
  return static_cast<size_t>(result);
}
size_t size(napi_env env, napi_value value) {
  auto result = offset(env, value);
  if (result > maximumBytes) fail("unsafe-ancestry");
  return result;
}
std::vector<uint8_t> bytes(napi_env env, napi_value value) {
  napi_typedarray_type type;
  size_t length, offset;
  void* data;
  napi_value buffer;
  check(napi_get_typedarray_info(env, value, &type, &length, &data, &buffer, &offset));
  if (type != napi_uint8_array || length > maximumBytes) fail("unsafe-ancestry");
  const auto* first = static_cast<const uint8_t*>(data);
  return length ? std::vector<uint8_t>(first, first + length) : std::vector<uint8_t>();
}
napi_value byteArray(napi_env env, const std::vector<uint8_t>& bytes) {
  void* data;
  napi_value buffer, result;
  check(napi_create_arraybuffer(env, bytes.size(), &data, &buffer));
  if (!bytes.empty()) std::memcpy(data, bytes.data(), bytes.size());
  check(napi_create_typedarray(env, napi_uint8_array, bytes.size(), buffer, 0, &result));
  return result;
}
template <typename T> napi_value wrap(napi_env env, const std::shared_ptr<T>& value, const napi_type_tag& tag, napi_value result = nullptr) {
  if (!result) result = object(env);
  auto* owned = new std::shared_ptr<T>(value);
  napi_status status = napi_wrap(env, result, owned, [](napi_env, void* data, void*) { delete static_cast<std::shared_ptr<T>*>(data); }, nullptr, nullptr);
  if (status != napi_ok) { delete owned; check(status); }
  check(napi_type_tag_object(env, result, &tag));
  check(napi_object_freeze(env, result));
  return result;
}
template <typename T> std::shared_ptr<T> unwrap(napi_env env, napi_value value, const napi_type_tag& tag) {
  bool tagged = false;
  check(napi_check_object_type_tag(env, value, &tag, &tagged));
  if (!tagged) fail("unsafe-ancestry");
  void* result = nullptr;
  check(napi_unwrap(env, value, &result));
  if (!result) fail("unsafe-ancestry");
  return *static_cast<std::shared_ptr<T>*>(result);
}
std::shared_ptr<Handle> handle(napi_env env, napi_value value) { return unwrap<Handle>(env, value, handleTag); }
std::shared_ptr<Handle> directory(napi_env env, napi_value value) { auto result = handle(env, value); if (result->object.kind != "directory") fail("unsafe-ancestry"); return result; }
std::shared_ptr<Handle> regular(napi_env env, napi_value value) { auto result = handle(env, value); if (result->object.kind != "regular") fail("unsafe-ancestry"); return result; }
std::shared_ptr<Anchor> anchor(napi_env env, napi_value value) { return unwrap<Anchor>(env, value, anchorTag); }
std::shared_ptr<Interval> interval(napi_env env, napi_value input) { return unwrap<Interval>(env, get(env, input, "interval"), intervalTag); }
std::string name(napi_env env, napi_value value) { return *unwrap<std::string>(env, value, nameTag); }
napi_value identity(napi_env env, const Identity& value) {
  auto result = object(env);
  put(env, result, "kind", text(env, value.kind)); put(env, result, "volumeUuid", text(env, value.volume));
  put(env, result, "device", text(env, value.device)); put(env, result, "inode", text(env, value.inode)); put(env, result, "birthtimeNs", text(env, value.birth));
  return result;
}
Identity identity(napi_env env, napi_value input) {
  return {string(env, get(env, input, "kind")), string(env, get(env, input, "volumeUuid")), string(env, get(env, input, "device")), string(env, get(env, input, "inode")), string(env, get(env, input, "birthtimeNs"))};
}
napi_value metadata(napi_env env, const Observation& value) {
  static_assert(sizeof(value.stat.st_uid) <= 4 && sizeof(value.stat.st_gid) <= 4 && sizeof(value.stat.st_mode) <= 4 && sizeof(value.stat.st_flags) <= 4 && sizeof(value.stat.st_nlink) <= 4);
  auto result = object(env);
  put(env, result, "uid", number(env, value.stat.st_uid)); put(env, result, "gid", number(env, value.stat.st_gid));
  put(env, result, "mode", number(env, value.stat.st_mode & 07777)); put(env, result, "flags", number(env, value.stat.st_flags)); put(env, result, "linkCount", number(env, value.stat.st_nlink));
  put(env, result, "aclBytesBase64", text(env, base64(value.acl.data(), value.acl.size())));
  napi_value yes; check(napi_get_boolean(env, true, &yes)); put(env, result, "localVolume", yes);
  return result;
}
napi_value observation(napi_env env, const Observation& value) {
  auto result = object(env); put(env, result, "object", identity(env, value.object)); put(env, result, "metadata", metadata(env, value)); return result;
}
napi_value anchorValue(napi_env env) {
  auto value = resolveAnchor();
  auto result = object(env), host = object(env);
  put(env, host, "writerUid", number(env, value->uid)); put(env, host, "accountUuid", text(env, value->accountUuid)); put(env, host, "hostUuid", text(env, value->hostUuid));
  put(env, host, "accountHomeDisplay", text(env, value->home)); put(env, host, "anchor", identity(env, value->directory->object));
  put(env, result, "host", host); put(env, result, "canonicalAnchorPath", text(env, value->path)); put(env, result, "directory", wrap(env, value->directory, handleTag));
  std::vector<std::shared_ptr<Handle>> chain;
  for (auto current = value->directory; current && current->parent; current = current->parent) chain.push_back(current);
  napi_value claims; check(napi_create_array_with_length(env, chain.size(), &claims));
  size_t index = 0;
  for (auto current = chain.rbegin(); current != chain.rend(); ++current) {
    auto claim = observation(env, guard(*current)), location = object(env);
    put(env, location, "parent", identity(env, (*current)->parent->object)); put(env, location, "rawNameBase64", text(env, base64((*current)->name.data(), (*current)->name.size())));
    put(env, claim, "location", location); check(napi_set_element(env, claims, index++, claim));
  }
  put(env, result, "ancestry", claims);
  return wrap(env, value, anchorTag, result);
}
const char* operations[] = {"resolveAccountAnchor", "component", "componentBytes", "observeAt", "observe", "openDirectoryNoFollow", "openRegularNoFollow", "requireLocation", "observeExclusionRoots", "requirePrivateLocalNonoverlap", "beginIntervalUnderHeldGate", "createDirectoryExclusive", "createRegularExclusive", "readBounded", "writeExact", "appendExact", "syncFile", "syncDirectory", "promoteExclusive", "replaceHeadGuarded", "expireAndDrain", "close", "readLedger"};
napi_value invoke(napi_env env, size_t operation, size_t argc, napi_value* args) {
  auto input = argc ? args[0] : undefined(env);
  switch (operation) {
    case 0: return anchorValue(env);
    case 1: {
      auto raw = bytes(env, input); std::string value(raw.begin(), raw.end()); component(value);
      return wrap(env, std::make_shared<std::string>(value), nameTag);
    }
    case 2: { auto value = name(env, input); return byteArray(env, std::vector<uint8_t>(value.begin(), value.end())); }
    case 3: {
      auto parent = directory(env, input); auto raw = name(env, args[1]); guard(parent);
      struct stat entry;
      auto result = object(env);
      if (fstatat(parent->descriptor.fd, raw.c_str(), &entry, AT_SYMLINK_NOFOLLOW) < 0) {
        if (errno != ENOENT) syscallResult(-1);
        put(env, result, "kind", text(env, "absent")); return result;
      }
      if (!S_ISDIR(entry.st_mode) && (!S_ISREG(entry.st_mode) || entry.st_nlink != 1)) fail("unsafe-ancestry");
      int fd = openat(parent->descriptor.fd, raw.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK | (S_ISDIR(entry.st_mode) ? O_DIRECTORY : 0));
      syscallResult(fd); Descriptor temporary(fd);
      auto observed = inspectFd(fd, true, S_ISDIR(entry.st_mode));
      if (observed.stat.st_dev != entry.st_dev || observed.stat.st_ino != entry.st_ino) fail("identity-changed");
      put(env, result, "kind", text(env, "present")); put(env, result, "observation", observation(env, observed)); return result;
    }
    case 4: return observation(env, guard(handle(env, input)));
    case 5: return wrap(env, openChild(directory(env, input), name(env, args[1]), true, false), handleTag);
    case 6: {
      auto access = string(env, args[2]); if (access != "read" && access != "read-write") fail("unsafe-ancestry");
      return wrap(env, openChild(directory(env, input), name(env, args[1]), false, access == "read-write"), handleTag);
    }
    case 7: {
      auto expected = identity(env, get(env, input, "object"));
      auto target = openChild(directory(env, get(env, input, "parent")), name(env, get(env, input, "name")), expected.kind == "directory", false);
      requireIdentity(target->object, expected); return observation(env, guard(target));
    }
    case 8: {
      auto paths = get(env, input, "requiredRepositoryAndSourcePaths"); uint32_t length;
      check(napi_get_array_length(env, paths, &length)); if (length > 64) fail("unsafe-ancestry");
      std::vector<std::string> required;
      for (uint32_t i = 0; i < length; ++i) { napi_value path; check(napi_get_element(env, paths, i, &path)); auto raw = bytes(env, path); required.emplace_back(raw.begin(), raw.end()); }
      return wrap(env, observeExclusions(anchor(env, get(env, input, "anchor")), required), exclusionsTag);
    }
    case 9: requireNonoverlap(anchor(env, get(env, input, "anchor")), directory(env, get(env, input, "namespace")), unwrap<Exclusions>(env, get(env, input, "exclusions"), exclusionsTag)); return undefined(env);
    case 10: {
      auto value = anchor(env, input); guard(value->directory); recheckExclusions(value);
      auto result = std::make_shared<Interval>(); result->anchor = value; return wrap(env, result, intervalTag);
    }
    case 11: case 12: return wrap(env, createChild(interval(env, input), directory(env, get(env, input, "parent")), name(env, get(env, input, "name")), operation == 11), handleTag);
    case 13: {
      auto file = regular(env, get(env, input, "file")); auto maximum = size(env, get(env, input, "maximumBytes"));
      auto exact = get(env, input, "exactLength"); napi_valuetype type; check(napi_typeof(env, exact, &type));
      auto length = type == napi_undefined ? checkedLength(guard(file).stat.st_size) : size(env, exact);
      return byteArray(env, readExact(file, maximum, length));
    }
    case 14: case 15: writeExact(interval(env, input), regular(env, get(env, input, "file")), bytes(env, get(env, input, "bytes")), identity(env, get(env, input, "expectedObject")), operation == 15, operation == 15 ? offset(env, get(env, input, "expectedLength")) : 0); return undefined(env);
    case 16: sync(interval(env, input), regular(env, get(env, input, "file"))); return undefined(env);
    case 17: sync(interval(env, input), directory(env, get(env, input, "directory"))); return undefined(env);
    case 18: promote(interval(env, input), directory(env, get(env, input, "sourceParent")), name(env, get(env, input, "sourceName")), directory(env, get(env, input, "destinationParent")), name(env, get(env, input, "destinationName")), identity(env, get(env, input, "expectedObject")), true); return undefined(env);
    case 19: {
      auto owner = interval(env, input); auto parent = directory(env, get(env, input, "parent"));
      auto temporaryName = name(env, get(env, input, "temporaryName")), headName = name(env, get(env, input, "headName"));
      auto temporaryObject = identity(env, get(env, input, "temporaryObject"));
      auto expected = get(env, input, "expectedHead"); auto kind = string(env, get(env, expected, "kind"));
      if (kind == "present") {
        auto oldObject = identity(env, get(env, expected, "object"));
        replaceHead(owner, parent, temporaryName, temporaryObject, headName, &oldObject, bytes(env, get(env, expected, "bytes")));
      } else if (kind == "absent") replaceHead(owner, parent, temporaryName, temporaryObject, headName, nullptr, {});
      else fail("unsafe-ancestry");
      return undefined(env);
    }
    case 20: {
      auto owner = unwrap<Interval>(env, input, intervalTag);
      try { checkpoint("before-expiry"); } catch (...) { owner->active = false; throw; }
      owner->active = false;
      checkpoint("after-expiry"); checkpoint("after-drain"); return undefined(env);
    }
    case 21: closeHandle(handle(env, input)); return undefined(env);
    case 22: {
      auto file = regular(env, get(env, input, "file"));
      auto kind = string(env, get(env, input, "kind"));
      std::shared_ptr<LedgerReadSnapshot> snapshot;
      napi_value token;
      size_t position = 0;
      if (kind == "first") {
        snapshot = startLedgerRead(file);
        snapshot->environment = env;
        token = wrap(env, snapshot, snapshotTag);
      } else if (kind == "next") {
        token = get(env, input, "snapshot");
        snapshot = unwrap<LedgerReadSnapshot>(env, token, snapshotTag);
        if (snapshot->environment != env) fail("unsafe-ancestry");
        position = offset(env, get(env, input, "offset"));
      } else fail("unsafe-ancestry");
      auto data = readLedgerWindow(snapshot, file, position);
      auto result = object(env);
      put(env, result, "snapshot", token);
      put(env, result, "totalLength", number(env, snapshot->totalLength));
      put(env, result, "bytes", byteArray(env, data));
      return result;
    }
    default: fail("io");
  }
}
napi_value dispatch(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value args[3]; void* data;
  napi_get_cb_info(env, info, &argc, args, nullptr, &data);
  size_t operation = reinterpret_cast<uintptr_t>(data);
  try {
    const size_t arities[] = {0,1,1,2,1,2,3,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1};
    if (argc != arities[operation]) fail("unsafe-ancestry");
    napi_value value = invoke(env, operation, argc, args);
    if (operation == 2) return value;
    napi_value result = object(env); put(env, result, "kind", text(env, "ok")); put(env, result, "value", value); return result;
  } catch (const std::exception& error) {
    bool pending = false; napi_is_exception_pending(env, &pending);
    if (pending) { napi_value ignored; napi_get_and_clear_last_exception(env, &ignored); }
    if (operation == 2) { napi_throw_type_error(env, nullptr, "Invalid native raw component"); return nullptr; }
    auto* failure = dynamic_cast<const Failure*>(&error);
    napi_value result = object(env); put(env, result, "kind", text(env, "native-failure")); put(env, result, "code", text(env, failure ? failure->code : "io")); put(env, result, "operation", text(env, operations[operation])); return result;
  }
}
#ifdef AOS_PUBLICATION_FIXTURE_ANCHOR
thread_local napi_ref fixtureHookReference = nullptr;
napi_value setFixtureCheckpoint(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value callback;
  check(napi_get_cb_info(env, info, &argc, &callback, nullptr, nullptr));
  if (fixtureHookReference) { check(napi_delete_reference(env, fixtureHookReference)); fixtureHookReference = nullptr; }
  checkpointHook = {};
  napi_valuetype type; check(napi_typeof(env, callback, &type));
  if (type == napi_function) {
    check(napi_create_reference(env, callback, 1, &fixtureHookReference));
    checkpointHook = [env](const char* edge) {
      napi_value callback, ignored;
      check(napi_get_reference_value(env, fixtureHookReference, &callback));
      napi_value argument = text(env, edge);
      if (napi_call_function(env, undefined(env), callback, 1, &argument, &ignored) != napi_ok) fail("io");
    };
  }
  return undefined(env);
}
#endif
napi_value initialize(napi_env env, napi_value exports) {
  put(env, exports, "nativeBoundaryVersion", number(env, 1));
  put(env, exports, "maximumFileOffset", number(env, maximumFileOffset()));
#ifdef AOS_PUBLICATION_FIXTURE_ANCHOR
  put(env, exports, "buildKind", text(env, "fixture"));
#else
  put(env, exports, "buildKind", text(env, "production"));
#endif
  for (size_t i = 0; i < sizeof operations / sizeof *operations; ++i) {
    napi_value method; check(napi_create_function(env, operations[i], NAPI_AUTO_LENGTH, dispatch, reinterpret_cast<void*>(i), &method));
    put(env, exports, operations[i], method);
  }
#ifdef AOS_PUBLICATION_FIXTURE_ANCHOR
  napi_value setter;
  check(napi_create_function(env, "setFixtureCheckpoint", NAPI_AUTO_LENGTH, setFixtureCheckpoint, nullptr, &setter));
  put(env, exports, "setFixtureCheckpoint", setter);
  check(napi_add_env_cleanup_hook(env, [](void*) { checkpointHook = {}; fixtureHookReference = nullptr; }, nullptr));
#endif
  check(napi_object_freeze(env, exports));
  return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
