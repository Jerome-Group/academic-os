import type { LaunchdJobDescription } from "../launchd/index.js";

export const STATE_REFRESH_LAUNCHD_JOB_NAME = "state-refresh";

export function describeStateRefreshLaunchdJob(input: {
  nodePath: string;
  runnerModulePath: string;
  cliPath: string;
  configPath: string;
  notificationPath: string;
}): LaunchdJobDescription {
  return {
    name: STATE_REFRESH_LAUNCHD_JOB_NAME,
    programArguments: [
      input.nodePath,
      input.runnerModulePath,
      input.cliPath,
      input.configPath,
      input.notificationPath,
    ],
    schedule: { kind: "interval", seconds: 30 * 60 },
    standardOutPath: "/dev/null",
    standardErrorPath: "/dev/null",
  };
}
