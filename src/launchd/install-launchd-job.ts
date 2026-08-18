import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LaunchdJobPlan, LaunchdJobTarget } from "./types.js";

export interface LaunchctlPort {
  bootstrap(domainTarget: string, plistPath: string): number | null;
  bootout(serviceTarget: string): number | null;
}

const LAUNCHCTL_PATH = "/bin/launchctl";

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
  await unloadLaunchdJob(plan, launchctl);
  await mkdir(dirname(plan.plistPath), { recursive: true });
  await writeAtomically(plan.plistPath, plan.plist);
  if (launchctl.bootstrap(plan.domainTarget, plan.plistPath) !== 0) {
    await rm(plan.plistPath, { force: true });
    throw new Error(`launchctl could not install ${plan.label}.`);
  }
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

async function writeAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
