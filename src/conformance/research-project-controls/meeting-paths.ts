const meetingDirectoryPattern =
  /^20 Supervisor Meetings\/(\d{4}-\d{2}-\d{2}) ([^/]+)$/u;

export function parseMeetingDirectory(
  path: string,
): { date: string; topic: string } | undefined {
  const match = meetingDirectoryPattern.exec(path);
  if (
    match === null ||
    !isCalendarDate(match[1] ?? "") ||
    (match[2] ?? "").trim() !== match[2]
  )
    return undefined;
  return { date: match[1] ?? "", topic: match[2] ?? "" };
}

export function isMeetingNotePath(path: string): boolean {
  const suffix = "/Meeting.md";
  return (
    path.endsWith(suffix) &&
    parseMeetingDirectory(path.slice(0, -suffix.length)) !== undefined
  );
}

export function isMeetingSourcePath(path: string): boolean {
  const marker = "/Sources/";
  const index = path.indexOf(marker);
  return index > 0 && parseMeetingDirectory(path.slice(0, index)) !== undefined;
}

export function isMeetingLearningPath(path: string): boolean {
  return isMeetingAreaPath(path, "10 Learning");
}

export function isMeetingExercisePath(path: string): boolean {
  return isMeetingAreaPath(path, "20 Exercises");
}

export function isMeetingRecordPath(path: string): boolean {
  const match =
    /^(20 Supervisor Meetings\/[^/]+)\/(10 Learning|20 Exercises)\/records\/\d{4}-[^/]+\.md$/u.exec(
      path,
    );
  return match !== null && parseMeetingDirectory(match[1] ?? "") !== undefined;
}

function isMeetingAreaPath(path: string, area: string): boolean {
  const marker = `/${area}/`;
  const index = path.indexOf(marker);
  if (index < 1 || parseMeetingDirectory(path.slice(0, index)) === undefined) {
    return false;
  }
  const child = path.slice(index + marker.length);
  return /^\d{2} \S(?:[^/]*\S)?$/u.test(child) && child !== "records";
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
