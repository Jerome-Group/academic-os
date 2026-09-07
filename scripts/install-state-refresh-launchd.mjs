#!/usr/bin/env node

import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  STATE_REFRESH_LAUNCHD_JOB_NAME,
  describeStateRefreshLaunchdJob,
} from "../dist/src/routine/state-refresh-launchd.js";
import { installLaunchdJob } from "../dist/src/launchd/index.js";
import {
  planOrRemoveLaunchdJob,
  writeLaunchdJobPreview,
} from "./launchd-installer-cli.mjs";

const notificationPath = "/usr/bin/osascript";
const scriptPath = fileURLToPath(import.meta.url);
const cliPath = fileURLToPath(new URL("../dist/src/cli.js", import.meta.url));
const runnerModulePath = fileURLToPath(
  new URL(
    "../dist/src/routine/state-refresh-launchd-runner.js",
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
    surface: "State Refresh",
    jobName: STATE_REFRESH_LAUNCHD_JOB_NAME,
    usage,
    describeJob,
  });
  if (removed !== undefined) {
    process.stdout.write(`Removed ${removed.label}.\n`);
    return;
  }
  if (dryRun) {
    writeLaunchdJobPreview("state refresh schedule", plan, {
      startInterval: plan.schedule.seconds,
    });
    return;
  }

  await installLaunchdJob(plan);
  process.stdout.write(
    `${[
      `Installed ${plan.label}.`,
      `Schedule: every ${plan.schedule.seconds} seconds while awake; missed intervals coalesce.`,
      `Plist: ${plan.plistPath}`,
      `Inspect: launchctl print ${plan.serviceTarget}`,
      `Manual run: launchctl kickstart ${plan.serviceTarget}`,
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
      "State Refresh config, built CLI, runner, and osascript must all exist.",
    );
  });
  return describeStateRefreshLaunchdJob({
    nodePath: process.execPath,
    runnerModulePath,
    cliPath,
    configPath,
    notificationPath,
  });
}
