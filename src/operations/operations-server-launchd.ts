import type { LaunchdJobDescription } from "../launchd/index.js";

export const OPERATIONS_SERVER_LAUNCHD_JOB_NAME = "operations-server";

// The Operations server is resident rather than scheduled: launchd starts it at login and starts
// it again whenever it stops, so a machine that has rebooted is reachable without anyone logging
// in to start it. Everything else the job needs — the port included — is in the config file the
// one argument names, because a LaunchAgent's arguments here are all absolute paths.
export function describeOperationsServerLaunchdJob(input: {
  nodePath: string;
  serverModulePath: string;
  configPath: string;
  logPath: string;
}): LaunchdJobDescription {
  return {
    name: OPERATIONS_SERVER_LAUNCHD_JOB_NAME,
    programArguments: [
      input.nodePath,
      input.serverModulePath,
      input.configPath,
    ],
    schedule: { kind: "keep-alive" },
    standardOutPath: input.logPath,
    standardErrorPath: input.logPath,
  };
}
