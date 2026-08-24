import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// launchd is handed absolute paths and nothing else, so the morning's subcommand is assembled here
// rather than in the plist: one entry point for the routine, whether the Owner runs it or 06:00 does.
export function runMorningRoutineLaunchdJob(input: {
  nodePath: string;
  cliPath: string;
  configPath: string;
}): number {
  const morning = spawnSync(
    input.nodePath,
    [input.cliPath, "routine", "morning", "--config", input.configPath],
    { stdio: "ignore" },
  );
  return morning.error === undefined && morning.status !== null
    ? morning.status
    : 1;
}

function runFromCommandLine(): void {
  const [cliPath, configPath] = process.argv.slice(2);
  if (cliPath === undefined || configPath === undefined) {
    process.stderr.write(
      "Usage: morning-routine-launchd-runner <cli-path> <config-path>\n",
    );
    process.exitCode = 64;
    return;
  }
  process.exitCode = runMorningRoutineLaunchdJob({
    nodePath: process.execPath,
    cliPath,
    configPath,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFromCommandLine();
}
