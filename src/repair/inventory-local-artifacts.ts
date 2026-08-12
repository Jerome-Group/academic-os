import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { repairInventoryPaths } from "./repair-inventory-paths.js";
import { RepairPlanError } from "./repair-plan-error.js";
import type { CompleteRepairInventory, LocalRepairArtifact } from "./types.js";

export async function inventoryLocalRepairArtifacts(
  moduleRoot: string,
  driveInventory: CompleteRepairInventory,
): Promise<LocalRepairArtifact[]> {
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
    const bytes = await readFile(path);
    artifacts.push({
      relativePath,
      device: String(metadata.dev),
      inode: String(metadata.ino),
      size: String(metadata.size),
      modifiedTime: metadata.mtimeNs.toString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}

function driveRelativePaths(inventory: CompleteRepairInventory): Set<string> {
  return new Set(repairInventoryPaths(inventory).values());
}
