import { spawnSync } from "node:child_process";
import { mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalConfig, resolveStateRoot } from "../config/index.js";
import { sha256 } from "../checksum.js";
import { runStateRefreshLaunchdJob } from "./run-state-refresh.js";

async function runFromCommandLine(): Promise<void> {
  const [cliPath, configPath, notificationPath = "/usr/bin/osascript"] =
    process.argv.slice(2);
  if (cliPath === undefined || configPath === undefined) {
    process.stderr.write(
      "Usage: state-refresh-launchd-runner <cli-path> <config-path> [notification-path]\n",
    );
    process.exitCode = 64;
    return;
  }
  try {
    const stateRoot = await resolveStateRoot(await loadLocalConfig(configPath));
    process.exitCode = await runStateRefreshLaunchdJob({
      nodePath: process.execPath,
      cliPath,
      configPath,
      notificationPath,
      stateRoot,
    });
    if (process.exitCode !== 75)
      await notifyRunnerTransition(configPath, notificationPath, false);
  } catch {
    await notifyRunnerTransition(configPath, notificationPath, true);
    process.exitCode = 1;
  }
}

async function notifyRunnerTransition(
  configPath: string,
  notificationPath: string,
  failed: boolean,
): Promise<void> {
  const directory = join(
    homedir(),
    ".local/state/academic-os/state-refresh-launcher",
  );
  const marker = join(directory, `${sha256(configPath)}.failed`);
  try {
    if (failed) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = await open(marker, "wx", 0o600);
      await file.close();
    } else await unlink(marker);
  } catch {
    return;
  }
  const message = failed
    ? "State refresh could not read or save private state; inspect its configuration, status and run.lock."
    : "State refresh runner recovered.";
  spawnSync(
    notificationPath,
    [
      "-e",
      `display notification ${JSON.stringify(message)} with title "academic-os"`,
    ],
    { stdio: "ignore", timeout: 10_000, killSignal: "SIGKILL" },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await runFromCommandLine();
