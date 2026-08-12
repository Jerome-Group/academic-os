import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

import { RepairPlanError, verifyRepairPlan } from "./plan-repair.js";
import type {
  RepairDriveOperationInput,
  RepairOperationResult,
} from "./execute-repair.js";
import type { RepairInventoryItem, RepairPlan } from "./types.js";

const folderMimeType = "application/vnd.google-apps.folder";
const executeFile = promisify(execFile);

export interface RepairRecoveryDrive {
  createFolder(
    input: RepairDriveOperationInput,
  ): Promise<RepairOperationResult>;
  copyFile(input: RepairDriveOperationInput): Promise<RepairOperationResult>;
  findByOperation(input: {
    parentId: string;
    changeSetId: string;
    operationId: string;
  }): Promise<RepairOperationResult[]>;
  readBytes(item: RepairInventoryItem): Promise<{
    bytes: Uint8Array;
    exportMimeType?: string;
  }>;
}

export interface DriveRecoveryManifestItem {
  sourceId: string;
  sourceParentIds: string[];
  backupId: string;
  backupParentId: string;
  name: string;
  mimeType: string;
  checksum: string | "unavailable";
}

export interface DriveRecoveryManifest {
  changeSetId: string;
  planDigest: string;
  recoveryRootId: string;
  retirementRootId: string;
  items: DriveRecoveryManifestItem[];
  verified: true;
}

export interface ByteRecoveryManifestItem {
  sourceId: string;
  relativePath: string;
  sha256: string;
  size: number;
  exportMimeType?: string;
}

export interface ByteRecoveryManifest {
  changeSetId: string;
  planDigest: string;
  path: string;
  items: ByteRecoveryManifestItem[];
  localArtifacts: RepairPlan["inventory"]["localArtifacts"];
  protection: "read-only-and-user-immutable";
  verified: true;
}

export interface RepairRecovery {
  drive: DriveRecoveryManifest;
  bytes: ByteRecoveryManifest;
}

export interface RecoverRepairPlanInput {
  plan: RepairPlan;
  drive: RepairRecoveryDrive;
  driveRecoveryRootId: string;
  snapshotRoot: string;
  sourceDevice: string;
  snapshotDevice: string;
  protectSnapshot?: (path: string) => Promise<void>;
  readLocalArtifact?: (
    artifact: RepairPlan["inventory"]["localArtifacts"][number],
  ) => Promise<Uint8Array>;
}

export async function recoverRepairPlan(
  input: RecoverRepairPlanInput,
): Promise<RepairRecovery> {
  verifyRepairPlan(input.plan);
  if (input.sourceDevice === input.snapshotDevice) {
    throw new RepairPlanError(
      "Byte recovery snapshot must use a separate storage device.",
    );
  }
  const paths = inventoryPaths(input.plan);
  const drive = await createDriveRecovery(input, paths);
  const bytes = await createByteRecovery(input, paths);
  return { drive, bytes };
}

async function createDriveRecovery(
  input: RecoverRepairPlanInput,
  paths: Map<string, string>,
): Promise<DriveRecoveryManifest> {
  const changeSetWrite = {
    operationId: "create-recovery-change-set",
    sourceId: `change-set:${input.plan.changeSetId}`,
    parentId: input.driveRecoveryRootId,
    name: input.plan.changeSetId,
    changeSetId: input.plan.changeSetId,
  };
  const existingChangeSet = await input.drive.findByOperation({
    parentId: input.driveRecoveryRootId,
    changeSetId: input.plan.changeSetId,
    operationId: changeSetWrite.operationId,
  });
  if (existingChangeSet.length > 1) {
    throw new RepairPlanError("Drive recovery change-set root is ambiguous.");
  }
  const changeSet =
    existingChangeSet[0] ?? (await input.drive.createFolder(changeSetWrite));
  if (changeSet.mimeType !== folderMimeType) {
    throw new RepairPlanError("Drive recovery change-set root is invalid.");
  }
  const backupIds = new Map<string, string>();
  const manifestItems: DriveRecoveryManifestItem[] = [];
  const items = [...input.plan.inventory.items].sort(
    (left, right) =>
      pathDepth(paths.get(left.id)) - pathDepth(paths.get(right.id)),
  );
  for (const item of items) {
    const parentId =
      item.id === input.plan.inventory.rootId
        ? changeSet.itemId
        : requiredBackupParent(item, backupIds);
    const write = {
      operationId: `recovery:${item.id}`,
      sourceId: item.id,
      parentId,
      name: item.name,
      changeSetId: input.plan.changeSetId,
    };
    const existing = await input.drive.findByOperation({
      parentId,
      changeSetId: input.plan.changeSetId,
      operationId: write.operationId,
    });
    if (existing.length > 1) {
      throw new RepairPlanError(`Drive recovery is ambiguous for ${item.id}.`);
    }
    const backup =
      existing[0] ??
      (item.mimeType === folderMimeType
        ? await input.drive.createFolder(write)
        : await input.drive.copyFile(write));
    verifyDriveBackup(item, backup);
    backupIds.set(item.id, backup.itemId);
    manifestItems.push({
      sourceId: item.id,
      sourceParentIds: item.parentIds,
      backupId: backup.itemId,
      backupParentId: parentId,
      name: backup.name,
      mimeType: backup.mimeType,
      checksum: item.md5Checksum ?? "unavailable",
    });
  }
  const retirementWrite = {
    operationId: "create-retirement-root",
    sourceId: `retirement:${input.plan.changeSetId}`,
    parentId: changeSet.itemId,
    name: "Retired Originals",
    changeSetId: input.plan.changeSetId,
  };
  const existingRetirement = await input.drive.findByOperation({
    parentId: changeSet.itemId,
    changeSetId: input.plan.changeSetId,
    operationId: retirementWrite.operationId,
  });
  if (existingRetirement.length > 1) {
    throw new RepairPlanError("Drive retirement folder is ambiguous.");
  }
  const retirement =
    existingRetirement[0] ?? (await input.drive.createFolder(retirementWrite));
  if (
    retirement.mimeType !== folderMimeType ||
    retirement.itemId.trim() === ""
  ) {
    throw new RepairPlanError("Drive retirement folder verification failed.");
  }
  return {
    changeSetId: input.plan.changeSetId,
    planDigest: input.plan.planDigest,
    recoveryRootId: changeSet.itemId,
    retirementRootId: retirement.itemId,
    items: manifestItems,
    verified: true,
  };
}

async function createByteRecovery(
  input: RecoverRepairPlanInput,
  paths: Map<string, string>,
): Promise<ByteRecoveryManifest> {
  const recoveryPath = join(input.snapshotRoot, input.plan.changeSetId);
  await mkdir(recoveryPath, { recursive: true });
  const manifestItems: ByteRecoveryManifestItem[] = [];
  for (const item of input.plan.inventory.items) {
    const relativePath = requiredPath(paths, item.id);
    const destination = join(recoveryPath, relativePath);
    if (item.mimeType === folderMimeType) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    const read = await input.drive.readBytes(item);
    try {
      await writeFile(destination, read.bytes, { flag: "wx" });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    const written = await readFile(destination);
    const sha256 = sha256Digest(written);
    if (sha256 !== sha256Digest(read.bytes)) {
      throw new RepairPlanError(
        `Byte recovery verification failed for Drive item ${item.id}.`,
      );
    }
    manifestItems.push({
      sourceId: item.id,
      relativePath,
      sha256,
      size: written.byteLength,
      ...(read.exportMimeType === undefined
        ? {}
        : { exportMimeType: read.exportMimeType }),
    });
  }
  for (const artifact of input.plan.inventory.localArtifacts) {
    if (
      input.readLocalArtifact === undefined ||
      artifact.relativePath.startsWith("/") ||
      artifact.relativePath.split("/").includes("..")
    ) {
      throw new RepairPlanError(
        `Local-only recovery is unavailable for ${artifact.relativePath}.`,
      );
    }
    const destination = join(recoveryPath, "local-only", artifact.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    const bytes = await input.readLocalArtifact(artifact);
    if (sha256Digest(bytes) !== artifact.sha256) {
      throw new RepairPlanError(
        `Local-only artifact changed before recovery: ${artifact.relativePath}.`,
      );
    }
    try {
      await writeFile(destination, bytes, { flag: "wx" });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    if (sha256Digest(await readFile(destination)) !== artifact.sha256) {
      throw new RepairPlanError(
        `Local-only recovery verification failed: ${artifact.relativePath}.`,
      );
    }
  }
  const manifest: ByteRecoveryManifest = {
    changeSetId: input.plan.changeSetId,
    planDigest: input.plan.planDigest,
    path: recoveryPath,
    items: manifestItems,
    localArtifacts: input.plan.inventory.localArtifacts,
    protection: "read-only-and-user-immutable",
    verified: true,
  };
  const manifestPath = join(recoveryPath, "manifest.json");
  try {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  }
  const stored = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as ByteRecoveryManifest;
  if (!isDeepStrictEqual(stored, manifest)) {
    throw new RepairPlanError("Byte recovery manifest verification failed.");
  }
  await (input.protectSnapshot ?? protectRepairSnapshot)(recoveryPath);
  return manifest;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function inventoryPaths(plan: RepairPlan): Map<string, string> {
  const items = new Map(plan.inventory.items.map((item) => [item.id, item]));
  const paths = new Map<string, string>();
  const visiting = new Set<string>();
  const resolveItem = (id: string): string => {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const item = items.get(id);
    if (item === undefined || visiting.has(id)) {
      throw new RepairPlanError("Repair inventory is disconnected or cyclic.");
    }
    visiting.add(id);
    const path =
      id === plan.inventory.rootId
        ? item.name
        : join(resolveItem(singleInventoryParent(item, items)), item.name);
    visiting.delete(id);
    paths.set(id, path);
    return path;
  };
  for (const item of items.values()) resolveItem(item.id);
  return paths;
}

function singleInventoryParent(
  item: RepairInventoryItem,
  items: Map<string, RepairInventoryItem>,
): string {
  const parents = item.parentIds.filter((id) => items.has(id));
  if (parents.length !== 1) {
    throw new RepairPlanError(
      `Repair inventory item ${item.id} lacks one unambiguous in-tree parent.`,
    );
  }
  return parents[0] as string;
}

function requiredBackupParent(
  item: RepairInventoryItem,
  backupIds: Map<string, string>,
): string {
  const parents = item.parentIds.flatMap((id) => {
    const backup = backupIds.get(id);
    return backup === undefined ? [] : [backup];
  });
  if (parents.length !== 1) {
    throw new RepairPlanError(
      `Drive recovery cannot resolve one backup parent for ${item.id}.`,
    );
  }
  return parents[0] as string;
}

function verifyDriveBackup(
  source: RepairInventoryItem,
  backup: RepairOperationResult,
): void {
  if (
    backup.itemId.trim() === "" ||
    backup.name !== source.name ||
    backup.mimeType !== source.mimeType ||
    (source.md5Checksum !== undefined &&
      backup.md5Checksum !== source.md5Checksum)
  ) {
    throw new RepairPlanError(
      `Drive recovery verification failed for item ${source.id}.`,
    );
  }
}

function requiredPath(paths: Map<string, string>, id: string): string {
  const path = paths.get(id);
  if (path === undefined) {
    throw new RepairPlanError(
      `Repair inventory path is unavailable for ${id}.`,
    );
  }
  return path;
}

function pathDepth(path: string | undefined): number {
  return path?.split("/").length ?? Number.POSITIVE_INFINITY;
}

function sha256Digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function protectRepairSnapshot(path: string): Promise<void> {
  await chmodRecursively(path);
  if (process.platform === "darwin") {
    await executeFile("/usr/bin/chflags", ["-R", "uchg", path]);
  }
}

async function chmodRecursively(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await chmodRecursively(child);
      await chmod(child, 0o555);
    } else {
      await chmod(child, 0o444);
    }
  }
  await chmod(path, 0o555);
}
