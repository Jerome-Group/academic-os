import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../checksum.js";
import { replacePrivateCalendarJson } from "../calendar/private-calendar-json.js";

// Launcher receipts cover failures before the routine can save its own detailed private report.
export async function runMorningRoutineLaunchdJob(input: {
  nodePath: string;
  cliPath: string;
  configPath: string;
  evidenceRoot?: string;
  notificationPath?: string;
}): Promise<number> {
  const morning = spawnSync(
    input.nodePath,
    [input.cliPath, "routine", "morning", "--config", input.configPath],
    { stdio: "ignore" },
  );
  const exitCode =
    morning.error === undefined && morning.status !== null ? morning.status : 1;
  const directory =
    input.evidenceRoot ??
    join(homedir(), ".local/state/academic-os/morning-launcher");
  const statusPath = join(directory, `${sha256(input.configPath)}.json`);
  const notify = (message: string) =>
    spawnSync(
      input.notificationPath ?? "/usr/bin/osascript",
      [
        "-e",
        `display notification ${JSON.stringify(message)} with title "academic-os"`,
      ],
      { stdio: "ignore", timeout: 10_000, killSignal: "SIGKILL" },
    );
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let before:
      | { exitCode: number; lastCompletedAt: string | null }
      | undefined;
    try {
      const value = JSON.parse(await readFile(statusPath, "utf8"));
      before = value;
      if (
        value?.schemaVersion !== 1 ||
        !Number.isInteger(before?.exitCode) ||
        !(
          before?.lastCompletedAt === null ||
          (typeof before?.lastCompletedAt === "string" &&
            Number.isFinite(Date.parse(before.lastCompletedAt)))
        )
      )
        throw new Error("Invalid launcher receipt.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const now = new Date().toISOString();
    await replacePrivateCalendarJson(statusPath, "morning-launcher", {
      schemaVersion: 1,
      lastAttempt: now,
      lastCompletedAt: exitCode === 0 ? now : (before?.lastCompletedAt ?? null),
      exitCode,
      status: exitCode === 0 ? "completed" : "failed",
    });
    if (exitCode !== 0 && (before === undefined || before.exitCode === 0))
      notify(
        "Morning routine launcher failed; inspect its private receipt and configuration.",
      );
    if (exitCode === 0 && before !== undefined && before.exitCode !== 0)
      notify(
        "Morning routine launcher recovered; maintenance findings remain in its private report.",
      );
  } catch {
    notify(
      "Morning routine launcher could not save private status; inspect local state permissions.",
    );
    return exitCode === 0 ? 1 : exitCode;
  }
  return exitCode;
}

async function runFromCommandLine(): Promise<void> {
  const [cliPath, configPath, notificationPath] = process.argv.slice(2);
  if (cliPath === undefined || configPath === undefined) {
    process.stderr.write(
      "Usage: morning-routine-launchd-runner <cli-path> <config-path> [notification-path]\n",
    );
    process.exitCode = 64;
    return;
  }
  process.exitCode = await runMorningRoutineLaunchdJob({
    nodePath: process.execPath,
    cliPath,
    configPath,
    ...(notificationPath === undefined ? {} : { notificationPath }),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await runFromCommandLine();
