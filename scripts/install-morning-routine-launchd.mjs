#!/usr/bin/env node

import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { installLaunchdJob } from "../dist/src/launchd/index.js";
import {
  describeMorningRoutineLaunchdJob,
  MORNING_ROUTINE_LAUNCHD_JOB_NAME,
} from "../dist/src/routine/index.js";
import {
  formatDailyTime,
  planOrRemoveLaunchdJob,
  writeLaunchdJobPreview,
} from "./launchd-installer-cli.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const cliPath = fileURLToPath(new URL("../dist/src/cli.js", import.meta.url));
const runnerModulePath = fileURLToPath(
  new URL(
    "../dist/src/routine/morning-routine-launchd-runner.js",
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
    surface: "Morning routine",
    jobName: MORNING_ROUTINE_LAUNCHD_JOB_NAME,
    usage,
    describeJob,
  });
  if (removed !== undefined) {
    process.stdout.write(`Removed ${removed.label}.\n`);
    return;
  }
  if (dryRun) {
    writeLaunchdJobPreview("routine morning schedule", plan, {
      offeringTimeZone: plan.schedule.timeZone,
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
      "Sibling: the 05:00 Calendar Refresh is a separate job and is untouched.",
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
  ]).catch(() => {
    throw new Error(
      "The morning routine's config, built CLI, and runner must all exist.",
    );
  });
  return describeMorningRoutineLaunchdJob({
    nodePath: process.execPath,
    runnerModulePath,
    cliPath,
    configPath,
  });
}
