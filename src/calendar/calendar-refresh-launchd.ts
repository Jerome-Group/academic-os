import type { LaunchdJobDescription } from "../launchd/index.js";
import { DEFAULT_CALENDAR_TIMEZONE } from "./setup-owned-calendars.js";

export const CALENDAR_REFRESH_LAUNCHD_JOB_NAME = "calendar-refresh";

export function describeCalendarRefreshLaunchdJob(input: {
  nodePath: string;
  runnerModulePath: string;
  cliPath: string;
  configPath: string;
  notificationPath: string;
}): LaunchdJobDescription {
  return {
    name: CALENDAR_REFRESH_LAUNCHD_JOB_NAME,
    programArguments: [
      input.nodePath,
      input.runnerModulePath,
      input.cliPath,
      input.configPath,
      input.notificationPath,
    ],
    schedule: {
      kind: "calendar-interval",
      hour: 5,
      minute: 0,
      timeZone: DEFAULT_CALENDAR_TIMEZONE,
    },
    standardOutPath: "/dev/null",
    standardErrorPath: "/dev/null",
  };
}
