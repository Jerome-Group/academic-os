import type { LaunchdJobDescription } from "../launchd/index.js";
import { OFFERING_TIMEZONE } from "./offering-calendar-day.js";

export const MORNING_ROUTINE_LAUNCHD_JOB_NAME = "morning-routine";

// The 05:00 Calendar Refresh is this job's untouched sibling: same installer, same plist shape, one
// hour apart. Output goes nowhere because the routine writes its own dated report — a log file would
// be a second record of the same morning, drifting from the one the Owner reads.
export function describeMorningRoutineLaunchdJob(input: {
  nodePath: string;
  runnerModulePath: string;
  cliPath: string;
  configPath: string;
}): LaunchdJobDescription {
  return {
    name: MORNING_ROUTINE_LAUNCHD_JOB_NAME,
    programArguments: [
      input.nodePath,
      input.runnerModulePath,
      input.cliPath,
      input.configPath,
    ],
    schedule: {
      kind: "calendar-interval",
      hour: 6,
      minute: 0,
      timeZone: OFFERING_TIMEZONE,
    },
    standardOutPath: "/dev/null",
    standardErrorPath: "/dev/null",
  };
}
