#include <sys/attr.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>
#ifndef AOS_POLICY_DATE_FIXTURE_SOURCE
#error A fixed private fixture source is required
#endif
int main(void) {
  int fd = open(AOS_POLICY_DATE_FIXTURE_SOURCE, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (fd < 0) return 2;
  struct attrlist attributes = {0};
  attributes.bitmapcount = ATTR_BIT_MAP_COUNT;
  attributes.commonattr = ATTR_CMN_CRTIME;
  struct timespec birth = {-315619200, 123456789};
  int result = fsetattrlist(fd, &attributes, &birth, sizeof birth, 0);
  struct stat observed;
  if (fstat(fd, &observed)) return 3;
  printf("{\"setter\":%d,\"seconds\":\"%lld\",\"nanoseconds\":%ld}\n", result, (long long)observed.st_birthtimespec.tv_sec, observed.st_birthtimespec.tv_nsec);
  close(fd);
  return result ? 4 : 0;
}
