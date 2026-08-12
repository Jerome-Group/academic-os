import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

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
    const bytes = await readFile(
      join(recovery.bytes.path, expected.relativePath),
    );
    if (
      bytes.byteLength !== expected.size ||
      createHash("sha256").update(bytes).digest("hex") !== expected.sha256
    ) {
      throw new RepairPlanError(
        `Byte recovery copy no longer verifies: ${expected.relativePath}.`,
      );
    }
  }
  for (const artifact of recovery.bytes.localArtifacts) {
    const bytes = await readFile(
      join(recovery.bytes.path, "local-only", artifact.relativePath),
    );
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      throw new RepairPlanError(
        `Local-only recovery no longer verifies: ${artifact.relativePath}.`,
      );
    }
  }
  const manifest = JSON.parse(
    await readFile(join(recovery.bytes.path, "manifest.json"), "utf8"),
  ) as unknown;
  if (!isDeepStrictEqual(manifest, recovery.bytes)) {
    throw new RepairPlanError("Stored byte recovery manifest changed.");
  }
  await verifyProtectionRecursively(recovery.bytes.path);
}

async function verifyProtectionRecursively(path: string): Promise<void> {
  const metadata = await stat(path);
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
