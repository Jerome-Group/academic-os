import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { InventoryEntry } from "../conformance/index.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import { resolveTarget } from "./resolve-target.js";
import type { LocalConfig, MountedInventoryResult } from "./types.js";

export async function inventoryMountedModule(
  config: LocalConfig,
): Promise<MountedInventoryResult> {
  const target = await resolveTarget(config);
  await ensureMaterialized(target.moduleRoot);
  return {
    target,
    inventory: {
      moduleCode: target.module,
      entries: await inventoryDirectory(target.moduleRoot),
    },
  };
}

export async function inventoryDirectory(
  root: string,
  relativeRoot = "",
): Promise<InventoryEntry[]> {
  const directory = relativeRoot === "" ? root : join(root, relativeRoot);
  const children = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const inventory: InventoryEntry[] = [];

  for (const child of children) {
    const relativePath =
      relativeRoot === "" ? child.name : `${relativeRoot}/${child.name}`;
    const metadata = await lstat(join(root, relativePath));
    const kind = metadata.isSymbolicLink()
      ? "symlink"
      : metadata.isDirectory()
        ? "directory"
        : metadata.isFile()
          ? "file"
          : "other";
    inventory.push({
      path: relativePath,
      kind,
      ...(kind === "file" ? { size: metadata.size } : {}),
      modifiedAt: metadata.mtime.toISOString(),
    });
    if (kind === "directory") {
      inventory.push(...(await inventoryDirectory(root, relativePath)));
    }
  }

  return inventory;
}
