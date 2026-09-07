import { spawnSync } from "node:child_process";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { writeFileAtomically } from "../write-file-atomically.js";

const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;
const services = ["calendar", "tasks"] as const;
type Service = (typeof services)[number];

interface RefreshState {
  lastAttempt: string;
  lastSuccess: string | null;
  exitCode: number;
}

interface RefreshStatus {
  schemaVersion: 1;
  services: Record<Service, RefreshState>;
}

export async function runStateRefreshLaunchdJob(input: {
  nodePath: string;
  cliPath: string;
  configPath: string;
  notificationPath: string;
  stateRoot: string;
}): Promise<number> {
  const directory = join(input.stateRoot, "state-refresh");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "run.lock");
  const lock = await open(lockPath, "wx", 0o600).catch((error: unknown) => {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "EEXIST"
    )
      return undefined;
    throw error;
  });
  if (lock === undefined) {
    const holder = Number(await readFile(lockPath, "utf8"));
    if (Number.isSafeInteger(holder) && holder > 0) {
      try {
        process.kill(holder, 0);
        return 75;
      } catch {
        // A stopped writer leaves evidence for recovery instead of an automatic lock deletion.
      }
    }
    throw new Error(
      "State-refresh lock is interrupted; inspect it before exact-lock removal.",
    );
  }
  try {
    await lock.writeFile(String(process.pid));
    const statusPath = join(directory, "status.json");
    const previous = await readStatus(statusPath);
    const states = {} as Record<Service, RefreshState>;
    const transitions: string[] = [];
    for (const service of services) {
      const result = spawnSync(
        input.nodePath,
        [
          input.cliPath,
          service,
          "refresh",
          "--config",
          input.configPath,
          "--json",
        ],
        {
          stdio: "ignore",
          timeout: REFRESH_TIMEOUT_MS,
          killSignal: "SIGKILL",
        },
      );
      const exitCode =
        result.error === undefined && result.status !== null
          ? result.status
          : 1;
      const now = new Date().toISOString();
      const before = previous?.services[service];
      states[service] = {
        lastAttempt: now,
        lastSuccess: exitCode === 0 ? now : (before?.lastSuccess ?? null),
        exitCode,
      };
      if (exitCode !== 0 && (before === undefined || before.exitCode === 0))
        transitions.push(
          `${service} refresh failed; inspect private state-refresh status`,
        );
      if (exitCode === 0 && before !== undefined && before.exitCode !== 0)
        transitions.push(`${service} refresh recovered`);
    }
    const status: RefreshStatus = { schemaVersion: 1, services: states };
    await writeFileAtomically(
      statusPath,
      `${JSON.stringify(status, null, 2)}\n`,
    );
    if (transitions.length > 0) {
      spawnSync(
        input.notificationPath,
        [
          "-e",
          `display notification ${JSON.stringify(transitions.join("; "))} with title "academic-os"`,
        ],
        { stdio: "ignore", timeout: 10_000, killSignal: "SIGKILL" },
      );
    }
    return services.some((service) => states[service].exitCode !== 0) ? 2 : 0;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function readStatus(path: string): Promise<RefreshStatus | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as RefreshStatus;
    if (
      value.schemaVersion !== 1 ||
      services.some(
        (service) => !Number.isInteger(value.services?.[service]?.exitCode),
      )
    )
      throw new Error(
        "Invalid state-refresh status; inspect the private file before retrying.",
      );
    return value;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return undefined;
    throw error;
  }
}
