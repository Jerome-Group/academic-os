#!/usr/bin/env node

import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { installLaunchdJob } from "../dist/src/launchd/index.js";
import {
  describeOperationsServerLaunchdJob,
  OPERATIONS_SERVER_LAUNCHD_JOB_NAME,
} from "../dist/src/operations/index.js";
import {
  planOrRemoveLaunchdJob,
  writeLaunchdJobPreview,
} from "./launchd-installer-cli.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const serverModulePath = fileURLToPath(
  new URL("../dist/src/operations/run-operations-server.js", import.meta.url),
);
const logDirectory = join(homedir(), "Library", "Logs", "academic-os");
const logPath = join(logDirectory, "operations-server.log");
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
    surface: "Operations server",
    jobName: OPERATIONS_SERVER_LAUNCHD_JOB_NAME,
    usage,
    describeJob,
  });
  if (removed !== undefined) {
    process.stdout.write(`Removed ${removed.label}.\n`);
    return;
  }
  if (dryRun) {
    writeLaunchdJobPreview("operations server schedule", plan, {
      keepAlive: plan.schedule.kind === "keep-alive",
      runAtLoad: plan.runAtLoad,
    });
    return;
  }

  await mkdir(logDirectory, { recursive: true });
  await installLaunchdJob(plan);
  process.stdout.write(
    `${[
      `Installed ${plan.label}.`,
      "Resident: launchd starts it at login and restarts it if it stops.",
      `Plist: ${plan.plistPath}`,
      `Log: ${logPath}`,
      `Inspect: launchctl print ${plan.serviceTarget}`,
      `Restart: launchctl kickstart -k ${plan.serviceTarget}`,
      `Remove: node ${scriptPath} --remove`,
    ].join("\n")}\n`,
  );
}

async function describeJob(configPath) {
  await Promise.all([access(configPath), access(serverModulePath)]).catch(
    () => {
      throw new Error(
        "The Operations server config and the built server module must both exist.",
      );
    },
  );
  return describeOperationsServerLaunchdJob({
    nodePath: process.execPath,
    serverModulePath,
    configPath,
    logPath,
  });
}
