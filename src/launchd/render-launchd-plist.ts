import type { LaunchdSchedule } from "./types.js";

export function renderLaunchdPlist(input: {
  label: string;
  programArguments: string[];
  schedule: LaunchdSchedule;
  runAtLoad: boolean;
  standardOutPath: string;
  standardErrorPath: string;
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "<key>Label</key>",
    `<string>${escapeXml(input.label)}</string>`,
    "<key>ProgramArguments</key>",
    "<array>",
    ...input.programArguments.map(
      (argument) => `<string>${escapeXml(argument)}</string>`,
    ),
    "</array>",
    ...renderSchedule(input.schedule),
    "<key>RunAtLoad</key>",
    input.runAtLoad ? "<true/>" : "<false/>",
    "<key>StandardOutPath</key>",
    `<string>${escapeXml(input.standardOutPath)}</string>`,
    "<key>StandardErrorPath</key>",
    `<string>${escapeXml(input.standardErrorPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function renderSchedule(schedule: LaunchdSchedule): string[] {
  if (schedule.kind === "keep-alive") {
    return ["<key>KeepAlive</key>", "<true/>"];
  }
  return [
    "<key>StartCalendarInterval</key>",
    "<dict>",
    "<key>Hour</key>",
    `<integer>${schedule.hour}</integer>`,
    "<key>Minute</key>",
    `<integer>${schedule.minute}</integer>`,
    "</dict>",
  ];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
