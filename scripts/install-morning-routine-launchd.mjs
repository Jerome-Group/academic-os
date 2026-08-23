#!/usr/bin/env node

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  installLaunchdJob,
  launchdJobTarget,
  planLaunchdJob,
  removeLaunchdJob,
} from "../dist/src/launchd/index.js";
import {
  describeMorningRoutineLaunchdJob,
  MORNING_ROUTINE_LAUNCHD_JOB_NAME,
} from "../dist/src/routine/index.js";
import {
  parseInstallerArguments,
  requireLaunchdUid,
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
  const arguments_ = parseInstallerArguments(process.argv.slice(2), usage);
  const homeDirectory = homedir();
  const uid = requireLaunchdUid("Morning routine");
  if (arguments_.remove) {
    const target = launchdJobTarget({
      name: MORNING_ROUTINE_LAUNCHD_JOB_NAME,
      homeDirectory,
      uid,
    });
    await removeLaunchdJob(target);
    process.stdout.write(`Removed ${target.label}.\n`);
    return;
  }

  const plan = planLaunchdJob({
    description: await describeJob(arguments_.configPath),
    hostTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    homeDirectory,
    uid,
  });
  if (arguments_.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: "routine morning schedule",
          outcome: "preview",
          label: plan.label,
          offeringTimeZone: plan.schedule.timeZone,
          startCalendarInterval: {
            Hour: plan.schedule.hour,
            Minute: plan.schedule.minute,
          },
          plistPath: plan.plistPath,
          programArguments: plan.programArguments,
          plist: plan.plist,
        },
        null,
        2,
      )}\n`,
    );
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
  const resolvedConfigPath = resolve(configPath);
  await Promise.all([
    access(resolvedConfigPath),
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
    configPath: resolvedConfigPath,
  });
}

function formatDailyTime(schedule) {
  const hour = String(schedule.hour).padStart(2, "0");
  const minute = String(schedule.minute).padStart(2, "0");
  return `${hour}:${minute} ${schedule.timeZone}`;
}
