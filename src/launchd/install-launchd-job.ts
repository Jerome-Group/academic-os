import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import type { LaunchdJobPlan, LaunchdJobTarget } from "./types.js";

export interface LaunchctlPort {
  bootstrap(domainTarget: string, plistPath: string): number | null;
  bootout(serviceTarget: string): number | null;
}

const LAUNCHCTL_PATH = "/bin/launchctl";

type PreviousInstallation =
  | { kind: "absent" }
  | { kind: "saved"; recoveryPath: string };

const systemLaunchctl: LaunchctlPort = {
  bootstrap: (domainTarget, plistPath) =>
    spawnSync(LAUNCHCTL_PATH, ["bootstrap", domainTarget, plistPath], {
      stdio: "inherit",
    }).status,
  bootout: (serviceTarget) =>
    spawnSync(LAUNCHCTL_PATH, ["bootout", serviceTarget], { stdio: "ignore" })
      .status,
};

export async function installLaunchdJob(
  plan: LaunchdJobPlan,
  launchctl: LaunchctlPort = systemLaunchctl,
): Promise<void> {
  await mkdir(dirname(plan.plistPath), { recursive: true });
  const previous = await savePreviousInstallation(plan.plistPath);
  try {
    await unloadLaunchdJob(plan, launchctl);
  } catch (error) {
    await removeSnapshot(previous, failureMessage(error));
    throw error;
  }
  let replacementWritten = false;
  try {
    await writeAtomically(plan.plistPath, plan.plist);
    replacementWritten = true;
    if (launchctl.bootstrap(plan.domainTarget, plan.plistPath) !== 0)
      throw new Error(`launchctl could not install ${plan.label}.`);
  } catch (error) {
    const failure = failureMessage(error);
    if (previous.kind === "absent") {
      if (replacementWritten) {
        try {
          await rm(plan.plistPath, { force: true });
        } catch (cleanupError) {
          throw new Error(
            `${failure} New plist cleanup failed at ${plan.plistPath}: ${failureMessage(cleanupError)}`,
            { cause: error },
          );
        }
      }
      throw error;
    }
    if (replacementWritten) {
      try {
        await rename(previous.recoveryPath, plan.plistPath);
      } catch (restoreError) {
        throw new Error(
          `${failure} Previous plist restoration failed; recoverable plist retained at ${previous.recoveryPath}: ${failureMessage(restoreError)}`,
          { cause: error },
        );
      }
    }
    try {
      if (launchctl.bootstrap(plan.domainTarget, plan.plistPath) !== 0)
        throw new Error(`launchctl could not restore ${plan.label}.`);
    } catch (restoreError) {
      throw new Error(
        `${failure} previous plist restored at ${plan.plistPath}, but bootstrap failed: ${failureMessage(restoreError)}`,
        { cause: error },
      );
    }
    const restored = `${failure} Previous plist restored and bootstrap succeeded.`;
    await removeSnapshot(previous, restored);
    throw new Error(restored, { cause: error });
  }
  await removeSnapshot(previous, `Replacement installed for ${plan.label}.`);
}

async function savePreviousInstallation(
  path: string,
): Promise<PreviousInstallation> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { kind: "absent" };
    throw error;
  }
  const recoveryPath = `${path}.${randomUUID()}.rollback`;
  await writeAtomically(recoveryPath, bytes);
  return { kind: "saved", recoveryPath };
}

async function removeSnapshot(
  previous: PreviousInstallation,
  context: string,
): Promise<void> {
  if (previous.kind === "absent") return;
  try {
    await rm(previous.recoveryPath, { force: true });
  } catch (error) {
    throw new Error(
      `${context} Snapshot cleanup failed; retained at ${previous.recoveryPath}: ${failureMessage(error)}`,
      { cause: error },
    );
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function removeLaunchdJob(
  target: LaunchdJobTarget,
  launchctl: LaunchctlPort = systemLaunchctl,
): Promise<void> {
  await unloadLaunchdJob(target, launchctl);
  await rm(target.plistPath, { force: true });
}

async function unloadLaunchdJob(
  target: LaunchdJobTarget,
  launchctl: LaunchctlPort,
): Promise<void> {
  if (!(await pathExists(target.plistPath))) return;
  if (launchctl.bootout(target.serviceTarget) !== 0) {
    throw new Error(
      `launchctl could not unload ${target.serviceTarget}; plist retained.`,
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomically(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch (cleanupError) {
      throw new Error(
        `${failureMessage(error)} Temporary plist cleanup failed at ${temporaryPath}: ${failureMessage(cleanupError)}`,
        { cause: error },
      );
    }
    throw error;
  }
}
