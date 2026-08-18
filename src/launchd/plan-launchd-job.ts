import { isAbsolute } from "node:path";

import { launchdJobTarget } from "./launchd-job-target.js";
import { renderLaunchdPlist } from "./render-launchd-plist.js";
import type {
  LaunchdCalendarIntervalSchedule,
  LaunchdJobDescription,
  LaunchdJobPlan,
} from "./types.js";

export function planLaunchdJob(input: {
  description: LaunchdJobDescription;
  hostTimeZone: string;
  homeDirectory: string;
  uid: number;
}): LaunchdJobPlan {
  const { description } = input;
  const target = launchdJobTarget({
    name: description.name,
    homeDirectory: input.homeDirectory,
    uid: input.uid,
  });
  assertAbsolutePaths(target.label, [
    ...description.programArguments,
    description.standardOutPath,
    description.standardErrorPath,
  ]);
  if (description.schedule.kind === "calendar-interval") {
    assertRealTimeOfDay(target.label, description.schedule);
    assertPinnedTimeZone(
      target.label,
      description.schedule,
      input.hostTimeZone,
    );
  }
  const job = {
    programArguments: description.programArguments,
    schedule: description.schedule,
    runAtLoad: description.schedule.kind === "keep-alive",
    standardOutPath: description.standardOutPath,
    standardErrorPath: description.standardErrorPath,
  };
  return {
    ...target,
    ...job,
    plist: renderLaunchdPlist({ label: target.label, ...job }),
  };
}

function assertAbsolutePaths(label: string, paths: string[]): void {
  if (paths.some((path) => !isAbsolute(path))) {
    throw new Error(`Every path in ${label} must be absolute.`);
  }
}

function assertRealTimeOfDay(
  label: string,
  schedule: LaunchdCalendarIntervalSchedule,
): void {
  if (!isClockTime(schedule.hour, 23) || !isClockTime(schedule.minute, 59)) {
    throw new Error(
      `${label} must run at a real time of day; received ${schedule.hour}:${schedule.minute}.`,
    );
  }
}

function assertPinnedTimeZone(
  label: string,
  schedule: LaunchdCalendarIntervalSchedule,
  hostTimeZone: string,
): void {
  if (hostTimeZone !== schedule.timeZone) {
    throw new Error(
      `${label} requires the Mac timezone to be ${schedule.timeZone}; this host is ${hostTimeZone}.`,
    );
  }
}

function isClockTime(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}
