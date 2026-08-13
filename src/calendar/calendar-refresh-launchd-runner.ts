import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CALENDAR_REFRESH_FAILURE_NOTIFICATION =
  'display notification "Calendar Refresh failed; stale state retained." with title "academic-os"';

export function runCalendarRefreshLaunchdJob(input: {
  nodePath: string;
  cliPath: string;
  configPath: string;
  notificationPath: string;
}): number {
  const refresh = spawnSync(
    input.nodePath,
    [
      input.cliPath,
      "calendar",
      "refresh",
      "--config",
      input.configPath,
      "--json",
    ],
    { stdio: "ignore" },
  );
  const exitCode =
    refresh.error === undefined && refresh.status !== null ? refresh.status : 1;
  if (exitCode !== 0) {
    spawnSync(
      input.notificationPath,
      ["-e", CALENDAR_REFRESH_FAILURE_NOTIFICATION],
      { stdio: "ignore" },
    );
  }
  return exitCode;
}

function runFromCommandLine(): void {
  const [cliPath, configPath, notificationPath = "/usr/bin/osascript"] =
    process.argv.slice(2);
  if (cliPath === undefined || configPath === undefined) {
    process.stderr.write(
      "Usage: calendar-refresh-launchd-runner <cli-path> <config-path> [notification-path]\n",
    );
    process.exitCode = 64;
    return;
  }
  process.exitCode = runCalendarRefreshLaunchdJob({
    nodePath: process.execPath,
    cliPath,
    configPath,
    notificationPath,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFromCommandLine();
}
