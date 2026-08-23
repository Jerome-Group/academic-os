#!/usr/bin/env node

import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  CALENDAR_REFRESH_LAUNCHD_JOB_NAME,
  describeCalendarRefreshLaunchdJob,
} from "../dist/src/calendar/index.js";
import { installLaunchdJob } from "../dist/src/launchd/index.js";
import {
  formatDailyTime,
  planOrRemoveLaunchdJob,
  writeLaunchdJobPreview,
} from "./launchd-installer-cli.mjs";

const notificationPath = "/usr/bin/osascript";
const scriptPath = fileURLToPath(import.meta.url);
const cliPath = fileURLToPath(new URL("../dist/src/cli.js", import.meta.url));
const runnerModulePath = fileURLToPath(
  new URL(
    "../dist/src/calendar/calendar-refresh-launchd-runner.js",
    import.meta.url,
  ),
);
const usage = `Usage: node ${scriptPath} --config <absolute-path> [--dry-run]
       node ${scriptPath} --remove`;

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

async function main() {
  const { removed, dryRun, plan } = await planOrRemoveLaunchdJob({
    surface: "Calendar Refresh",
    jobName: CALENDAR_REFRESH_LAUNCHD_JOB_NAME,
    usage,
    describeJob,
  });
  if (removed !== undefined) {
    process.stdout.write(`Removed ${removed.label}.\n`);
    return;
  }
  if (dryRun) {
    writeLaunchdJobPreview("calendar refresh schedule", plan, {
      calendarTimeZone: plan.schedule.timeZone,
      startCalendarInterval: {
        Hour: plan.schedule.hour,
        Minute: plan.schedule.minute,
      },
    });
    return;
  }

  await installLaunchdJob(plan);
  process.stdout.write(
    `${[
      `Installed ${plan.label}.`,
      `Schedule: ${formatDailyTime(plan.schedule)}; launchd catches up after sleep/wake.`,
      `Plist: ${plan.plistPath}`,
      `Inspect: launchctl print ${plan.serviceTarget}`,
      `Manual run: launchctl kickstart -k ${plan.serviceTarget}`,
      `Remove: node ${scriptPath} --remove`,
    ].join("\n")}\n`,
  );
}

async function describeJob(configPath) {
  await Promise.all([
    access(configPath),
    access(cliPath),
    access(runnerModulePath),
    access(notificationPath),
  ]).catch(() => {
    throw new Error(
      "Calendar Refresh config, built CLI, runner, and osascript must all exist.",
    );
  });
  return describeCalendarRefreshLaunchdJob({
    nodePath: process.execPath,
    runnerModulePath,
    cliPath,
    configPath,
    notificationPath,
  });
}
