#include <CoreFoundation/CoreFoundation.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
#include <cstring>
#include <string>

int main(int argc, char** argv) {
  if (argc != 3 || getuid() == 0 || getuid() != geteuid()) return 2;
  const std::string root = AOS_ALIAS_FIXTURE_ROOT;
  const std::string destination = argv[2];
  char targetPath[PATH_MAX], parentPath[PATH_MAX];
  const auto separator = destination.find_last_of('/');
  if (separator == std::string::npos || !realpath(argv[1], targetPath) || !realpath(destination.substr(0, separator).c_str(), parentPath)) return 3;
  if (std::string(targetPath).rfind(root + "/", 0) != 0 || (parentPath != root && std::string(parentPath).rfind(root + "/", 0) != 0)) return 4;
  struct stat target, existing;
  if (stat(targetPath, &target) || target.st_uid != getuid() || lstat(destination.c_str(), &existing) == 0) return 5;
  CFURLRef source = CFURLCreateFromFileSystemRepresentation(nullptr, reinterpret_cast<const UInt8*>(targetPath), strlen(targetPath), S_ISDIR(target.st_mode));
  CFURLRef output = CFURLCreateFromFileSystemRepresentation(nullptr, reinterpret_cast<const UInt8*>(destination.data()), destination.size(), false);
  const void* keys[] = {kCFURLPathKey, kCFURLIsDirectoryKey, kCFURLFileResourceIdentifierKey, kCFURLVolumeUUIDStringKey};
  CFArrayRef properties = CFArrayCreate(nullptr, keys, 4, &kCFTypeArrayCallBacks);
  CFErrorRef error = nullptr;
  CFDataRef bookmark = CFURLCreateBookmarkData(nullptr, source, kCFURLBookmarkCreationSuitableForBookmarkFile, properties, nullptr, &error);
  if (error) CFRelease(error);
  error = nullptr;
  bool okay = bookmark && CFURLWriteBookmarkDataToFile(bookmark, output, 0, &error);
  if (error) CFRelease(error);
  if (bookmark) CFRelease(bookmark);
  CFRelease(properties); CFRelease(source); CFRelease(output);
  return okay && chmod(destination.c_str(), 0600) == 0 ? 0 : 6;
}
