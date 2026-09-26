import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

import { checksumFile } from "../checksum-file.js";
import { isContainedBy } from "../mounted/is-contained-by.js";
import type { RepairRecovery } from "./recover-repair.js";
import { RepairPlanError } from "./plan-repair.js";
import type { CompleteRepairInventory } from "./types.js";

const executeFile = promisify(execFile);

export interface RepairRecoveryInventoryReader {
  inventory(rootId: string): Promise<CompleteRepairInventory>;
}

export async function verifyRepairRecovery(
  recovery: RepairRecovery,
  drive: RepairRecoveryInventoryReader,
): Promise<void> {
  if (
    recovery.drive.verified !== true ||
    recovery.bytes.verified !== true ||
    recovery.drive.planDigest !== recovery.bytes.planDigest ||
    recovery.drive.changeSetId !== recovery.bytes.changeSetId
  ) {
    throw new RepairPlanError("Repair recovery manifests disagree.");
  }
  const inventory = await drive.inventory(recovery.drive.recoveryRootId);
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  for (const expected of recovery.drive.items) {
    const actual = items.get(expected.backupId);
    if (
      actual === undefined ||
      actual.name !== expected.name ||
      actual.mimeType !== expected.mimeType ||
      !actual.parentIds.includes(expected.backupParentId) ||
      (expected.checksum !== "unavailable" &&
        actual.md5Checksum !== expected.checksum)
    ) {
      throw new RepairPlanError(
        `Drive recovery copy no longer verifies: ${expected.backupId}.`,
      );
    }
  }
  if (!items.has(recovery.drive.retirementRootId)) {
    throw new RepairPlanError("Drive retirement root no longer verifies.");
  }
  for (const expected of recovery.bytes.items) {
    const fingerprint = await snapshotChecksum(
      recovery.bytes.path,
      expected.relativePath,
    ).catch(() => {
      throw new RepairPlanError(
        `Byte recovery copy no longer verifies: ${expected.relativePath}.`,
      );
    });
    if (
      fingerprint.size !== BigInt(expected.size) ||
      fingerprint.sha256 !== expected.sha256
    ) {
      throw new RepairPlanError(
        `Byte recovery copy no longer verifies: ${expected.relativePath}.`,
      );
    }
  }
  for (const artifact of recovery.bytes.localArtifacts) {
    const fingerprint = await snapshotChecksum(
      recovery.bytes.path,
      `local-only/${artifact.relativePath}`,
    ).catch(() => {
      throw new RepairPlanError(
        `Local-only recovery no longer verifies: ${artifact.relativePath}.`,
      );
    });
    if (
      fingerprint.size !== BigInt(artifact.size) ||
      fingerprint.sha256 !== artifact.sha256
    ) {
      throw new RepairPlanError(
        `Local-only recovery no longer verifies: ${artifact.relativePath}.`,
      );
    }
  }
  const manifestPath = await ordinarySnapshotPath(
    recovery.bytes.path,
    "manifest.json",
  );
  const manifestHandle = await open(
    manifestPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let manifest: unknown;
  try {
    if (!(await manifestHandle.stat()).isFile()) {
      throw new RepairPlanError(
        "Stored byte recovery manifest is not an ordinary file.",
      );
    }
    manifest = JSON.parse(await manifestHandle.readFile("utf8"));
  } finally {
    await manifestHandle.close();
  }
  if (!isDeepStrictEqual(manifest, recovery.bytes)) {
    throw new RepairPlanError("Stored byte recovery manifest changed.");
  }
  await verifyProtectionRecursively(recovery.bytes.path);
}

async function snapshotChecksum(root: string, relativePath: string) {
  const path = await ordinarySnapshotPath(root, relativePath);
  const result = await checksumFile(path);
  await ordinarySnapshotPath(root, relativePath);
  return result;
}

async function ordinarySnapshotPath(
  root: string,
  relativePath: string,
): Promise<string> {
  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, relativePath);
  if (path === resolvedRoot || !isContainedBy(resolvedRoot, path)) {
    throw new RepairPlanError(
      `Byte recovery path escapes its snapshot: ${relativePath}.`,
    );
  }
  let directory = resolvedRoot;
  const parent = relative(resolvedRoot, dirname(path));
  for (const component of ["", ...(parent === "" ? [] : parent.split(sep))]) {
    directory = join(directory, component);
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new RepairPlanError(
        `Byte recovery path is not an ordinary directory: ${directory}.`,
      );
    }
  }
  if (!(await lstat(path)).isFile()) {
    throw new RepairPlanError(
      `Byte recovery path is not an ordinary file: ${path}.`,
    );
  }
  return path;
}

async function verifyProtectionRecursively(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() && !metadata.isDirectory()) {
    throw new RepairPlanError(
      `Byte recovery path is not an ordinary file or directory: ${path}.`,
    );
  }
  if (metadata.mode & 0o222) {
    throw new RepairPlanError(`Byte recovery path is still writable: ${path}.`);
  }
  if (process.platform === "darwin") {
    const { stdout } = await executeFile("/usr/bin/stat", ["-f", "%Sf", path]);
    if (
      !stdout
        .split(",")
        .map((flag) => flag.trim())
        .includes("uchg")
    ) {
      throw new RepairPlanError(
        `Byte recovery path is not user-immutable: ${path}.`,
      );
    }
  }
  if (!metadata.isDirectory()) return;
  for (const entry of await readdir(path)) {
    await verifyProtectionRecursively(join(path, entry));
  }
}
