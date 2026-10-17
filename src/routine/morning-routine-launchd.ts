import type { LaunchdJobDescription } from "../launchd/index.js";
import { OFFERING_TIMEZONE } from "./offering-calendar-day.js";

export const MORNING_ROUTINE_LAUNCHD_JOB_NAME = "morning-routine";

export function describeMorningRoutineLaunchdJob(input: {
  nodePath: string;
  runnerModulePath: string;
  cliPath: string;
  configPath: string;
  executableSearchPath: string;
}): LaunchdJobDescription {
  return {
    name: MORNING_ROUTINE_LAUNCHD_JOB_NAME,
    programArguments: [
      input.nodePath,
      input.runnerModulePath,
      input.cliPath,
      input.configPath,
    ],
    executableSearchPath: input.executableSearchPath,
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
