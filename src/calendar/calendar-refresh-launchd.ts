import { isAbsolute } from "node:path";

import { DEFAULT_CALENDAR_TIMEZONE } from "./setup-owned-calendars.js";

export const CALENDAR_REFRESH_LAUNCHD_LABEL =
  "com.jerome-group.academic-os.calendar-refresh";

export interface CalendarRefreshLaunchdPlan {
  label: typeof CALENDAR_REFRESH_LAUNCHD_LABEL;
  calendarTimeZone: typeof DEFAULT_CALENDAR_TIMEZONE;
  startCalendarInterval: { Hour: 5; Minute: 0 };
  runAtLoad: false;
  standardOutPath: "/dev/null";
  standardErrorPath: "/dev/null";
  programArguments: string[];
  plist: string;
}

export function createCalendarRefreshLaunchdPlan(input: {
  hostTimeZone: string;
  nodePath: string;
  runnerModulePath: string;
  cliPath: string;
  configPath: string;
  notificationPath: string;
}): CalendarRefreshLaunchdPlan {
  if (input.hostTimeZone !== DEFAULT_CALENDAR_TIMEZONE) {
    throw new Error(
      `Calendar Refresh requires the Mac timezone to be ${DEFAULT_CALENDAR_TIMEZONE}.`,
    );
  }
  const programArguments = [
    input.nodePath,
    input.runnerModulePath,
    input.cliPath,
    input.configPath,
    input.notificationPath,
  ];
  if (programArguments.some((path) => !isAbsolute(path))) {
    throw new Error("Calendar Refresh LaunchAgent paths must be absolute.");
  }
  return {
    label: CALENDAR_REFRESH_LAUNCHD_LABEL,
    calendarTimeZone: DEFAULT_CALENDAR_TIMEZONE,
    startCalendarInterval: { Hour: 5, Minute: 0 },
    runAtLoad: false,
    standardOutPath: "/dev/null",
    standardErrorPath: "/dev/null",
    programArguments,
    plist: renderLaunchdPlist(programArguments),
  };
}

function renderLaunchdPlist(programArguments: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "<key>Label</key>",
    `<string>${escapeXml(CALENDAR_REFRESH_LAUNCHD_LABEL)}</string>`,
    "<key>ProgramArguments</key>",
    "<array>",
    ...programArguments.map(
      (argument) => `<string>${escapeXml(argument)}</string>`,
    ),
    "</array>",
    "<key>StartCalendarInterval</key>",
    "<dict>",
    "<key>Hour</key>",
    "<integer>5</integer>",
    "<key>Minute</key>",
    "<integer>0</integer>",
    "</dict>",
    "<key>RunAtLoad</key>",
    "<false/>",
    "<key>StandardOutPath</key>",
    "<string>/dev/null</string>",
    "<key>StandardErrorPath</key>",
    "<string>/dev/null</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
