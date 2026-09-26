import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import { checksumFile } from "../checksum-file.js";
import { ensureMaterialized } from "../mounted/ensure-materialized.js";

import { repairInventoryPaths } from "./repair-inventory-paths.js";
import { RepairPlanError } from "./repair-plan-error.js";
import type { CompleteRepairInventory, LocalRepairArtifact } from "./types.js";

export async function inventoryLocalRepairArtifacts(
  moduleRoot: string,
  driveInventory: CompleteRepairInventory,
): Promise<LocalRepairArtifact[]> {
  await ensureMaterialized(moduleRoot);
  const drivePaths = driveRelativePaths(driveInventory);
  const artifacts: LocalRepairArtifact[] = [];
  await walk(moduleRoot, "", drivePaths, artifacts);
  return artifacts.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function walk(
  root: string,
  relativeDirectory: string,
  drivePaths: Set<string>,
  artifacts: LocalRepairArtifact[],
): Promise<void> {
  const directory = join(root, relativeDirectory);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath =
      relativeDirectory === ""
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
    const path = join(root, relativePath);
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink()) {
      throw new RepairPlanError(
        `Mounted repair inventory contains a symlink: ${relativePath}.`,
      );
    }
    if (metadata.isDirectory()) {
      await walk(root, relativePath, drivePaths, artifacts);
      continue;
    }
    if (!metadata.isFile()) {
      throw new RepairPlanError(
        `Mounted repair inventory contains a special node: ${relativePath}.`,
      );
    }
    if (drivePaths.has(relativePath)) continue;
    const checksum = await checksumFile(path, metadata);
    artifacts.push({
      relativePath,
      device: String(metadata.dev),
      inode: String(metadata.ino),
      size: String(metadata.size),
      modifiedTime: metadata.mtimeNs.toString(),
      sha256: checksum.sha256,
    });
  }
}

function driveRelativePaths(inventory: CompleteRepairInventory): Set<string> {
  return new Set(repairInventoryPaths(inventory).values());
}
