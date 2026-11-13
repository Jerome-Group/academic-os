import { spawn } from "node:child_process";
import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadExternalStoragePolicy,
  verifyExternalStoragePolicy,
  type ExternalStoragePolicy,
} from "./external-storage-policy.js";

export async function runExternalStorageLaunchdJob(
  input: {
    policyPath: string;
    logPath: string;
    programArguments: string[];
  },
  verify: (
    policy: ExternalStoragePolicy,
  ) => Promise<void> = verifyExternalStoragePolicy,
): Promise<number> {
  const policy = await loadExternalStoragePolicy(input.policyPath);
  const executable = input.programArguments[0];
  if (executable === undefined)
    throw new Error("LaunchAgent program is missing.");
  if (
    input.logPath !== "/dev/null" &&
    input.logPath !== join(policy.logRoot, "operations-server.log")
  )
    throw new Error("LaunchAgent log path does not match storage policy.");
  if (!input.programArguments.includes(policy.configPath))
    throw new Error(
      "LaunchAgent configuration does not match its storage policy.",
    );
  await verify(policy);
  for (const name of ["npm", "uv", "pip"]) {
    const path = join(policy.cacheRoot, name);
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (
      (await realpath(path)) !== path ||
      !(await stat(path)).isDirectory() ||
      (await stat(path)).dev !== (await stat(policy.cacheRoot)).dev
    )
      throw new Error(`Configured ${name} cache redirects to another volume.`);
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TMPDIR: policy.tempRoot,
    TMP: policy.tempRoot,
    TEMP: policy.tempRoot,
    SQLITE_TMPDIR: policy.tempRoot,
    XDG_CACHE_HOME: policy.cacheRoot,
    XDG_STATE_HOME: policy.stateRoot,
    npm_config_cache: join(policy.cacheRoot, "npm"),
    UV_CACHE_DIR: join(policy.cacheRoot, "uv"),
    PIP_CACHE_DIR: join(policy.cacheRoot, "pip"),
  };
  const log =
    input.logPath === "/dev/null"
      ? undefined
      : openGuardedLog(input.logPath, (await stat(policy.logRoot)).dev);
  try {
    const child = spawn(executable, input.programArguments.slice(1), {
      env: environment,
      detached: true,
      stdio: ["ignore", log ?? "ignore", log ?? "ignore"],
    });
    const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
    const forward = (signal: (typeof signals)[number]) => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          // The child exited before the signal reached its process group.
        }
      }
    };
    const listeners = signals.map((signal) => {
      const listener = () => forward(signal);
      process.on(signal, listener);
      return { signal, listener };
    });
    try {
      return await new Promise<number>((resolve) => {
        child.once("error", () => resolve(1));
        child.once("close", (status) => resolve(status ?? 1));
      });
    } finally {
      for (const { signal, listener } of listeners)
        process.off(signal, listener);
    }
  } finally {
    if (log !== undefined) closeSync(log);
  }
}

function openGuardedLog(path: string, expectedDevice: number): number {
  const descriptor = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_APPEND |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  const metadata = fstatSync(descriptor);
  if (
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    metadata.dev !== expectedDevice ||
    metadata.uid !== process.getuid?.()
  ) {
    closeSync(descriptor);
    throw new Error("Operations log has an unsafe file identity.");
  }
  return descriptor;
}

async function runFromCommandLine(): Promise<void> {
  const [policyPath, logPath, ...programArguments] = process.argv.slice(2);
  if (!policyPath || !logPath || programArguments.length < 2) {
    process.stderr.write(
      "Usage: external-storage-launchd-runner <policy> <log-path> <program> [arguments...]\n",
    );
    process.exitCode = 64;
    return;
  }
  try {
    process.exitCode = await runExternalStorageLaunchdJob({
      policyPath,
      logPath,
      programArguments,
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await runFromCommandLine();
