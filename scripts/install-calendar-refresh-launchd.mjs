#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CALENDAR_REFRESH_LAUNCHD_LABEL,
  createCalendarRefreshLaunchdPlan,
} from "../dist/src/calendar/index.js";

const notificationPath = "/usr/bin/osascript";
const launchctlPath = "/bin/launchctl";
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
  const arguments_ = parseArguments(process.argv.slice(2));
  const paths = schedulePaths();
  if (arguments_.remove) {
    await removeSchedule(paths);
    process.stdout.write(`Removed ${CALENDAR_REFRESH_LAUNCHD_LABEL}.\n`);
    return;
  }

  const plan = await createPlan(arguments_.configPath);
  if (arguments_.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: "calendar refresh schedule",
          outcome: "preview",
          label: plan.label,
          calendarTimeZone: plan.calendarTimeZone,
          startCalendarInterval: plan.startCalendarInterval,
          plistPath: paths.plistPath,
          programArguments: plan.programArguments,
          plist: plan.plist,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  await installSchedule(paths, plan.plist);
  process.stdout.write(
    `${[
      `Installed ${CALENDAR_REFRESH_LAUNCHD_LABEL}.`,
      `Schedule: 05:00 ${plan.calendarTimeZone}; launchd catches up after sleep/wake.`,
      `Plist: ${paths.plistPath}`,
      `Inspect: launchctl print ${paths.serviceTarget}`,
      `Manual run: launchctl kickstart -k ${paths.serviceTarget}`,
      `Remove: node ${scriptPath} --remove`,
    ].join("\n")}\n`,
  );
}

function parseArguments(arguments_) {
  let configPath;
  let dryRun = false;
  let remove = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--config") {
      const value = arguments_[index + 1];
      if (
        value === undefined ||
        value.startsWith("--") ||
        configPath !== undefined
      ) {
        throw new Error(usage);
      }
      configPath = value;
      index += 1;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--remove") {
      remove = true;
    } else if (argument === "--help") {
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    } else {
      throw new Error(`Unexpected argument: ${argument}.\n${usage}`);
    }
  }
  if (remove && (dryRun || configPath !== undefined)) {
    throw new Error("--remove cannot be combined with --config or --dry-run.");
  }
  if (!remove && configPath === undefined) {
    throw new Error(usage);
  }
  return { configPath, dryRun, remove };
}

function schedulePaths() {
  const home = homedir();
  const plistPath = join(
    home,
    "Library",
    "LaunchAgents",
    `${CALENDAR_REFRESH_LAUNCHD_LABEL}.plist`,
  );
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error(
      "Calendar Refresh scheduling requires a macOS user session.",
    );
  }
  const serviceTarget = `gui/${uid}/${CALENDAR_REFRESH_LAUNCHD_LABEL}`;
  return { plistPath, serviceTarget };
}

async function createPlan(configPath) {
  const resolvedConfigPath = resolve(configPath);
  await Promise.all([
    access(resolvedConfigPath),
    access(cliPath),
    access(runnerModulePath),
    access(notificationPath),
  ]).catch(() => {
    throw new Error(
      "Calendar Refresh config, built CLI, runner, and osascript must all exist.",
    );
  });
  return createCalendarRefreshLaunchdPlan({
    hostTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    nodePath: process.execPath,
    runnerModulePath,
    cliPath,
    configPath: resolvedConfigPath,
    notificationPath,
  });
}

async function installSchedule(paths, plist) {
  await unloadSchedule(paths);
  await mkdir(dirname(paths.plistPath), { recursive: true });
  await writeAtomically(paths.plistPath, plist);
  const result = spawnSync(
    launchctlPath,
    ["bootstrap", `gui/${process.getuid()}`, paths.plistPath],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    await rm(paths.plistPath, { force: true });
    throw new Error("launchctl could not install the Calendar Refresh job.");
  }
}

async function removeSchedule(paths) {
  await unloadSchedule(paths);
  await rm(paths.plistPath, { force: true });
}

async function unloadSchedule(paths) {
  if (!(await pathExists(paths.plistPath))) return;
  const result = runLaunchctl(["bootout", paths.serviceTarget]);
  if (result.status !== 0) {
    throw new Error(
      `launchctl could not unload ${paths.serviceTarget}; plist retained.`,
    );
  }
}

function runLaunchctl(arguments_) {
  return spawnSync(launchctlPath, arguments_, { stdio: "ignore" });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomically(path, content) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
