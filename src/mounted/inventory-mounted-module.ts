import { isMountArtifact } from "../contract/mount-artifacts.js";
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
      provenance: {
        source: "mounted",
        target: target.moduleRoot,
        completeness: "complete",
        diagnostics: [],
        excludedTrashedItems: 0,
      },
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
    if (
      isMountArtifact({
        name: child.name,
        isFile: metadata.isFile(),
        size: metadata.size,
      })
    ) {
      continue;
    }
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
      providerMetadata: {
        itemId: {
          availability: "unavailable",
          reason:
            "Mounted inventory does not expose a stable provider item ID.",
        },
        parentIds: {
          availability: "unavailable",
          reason:
            "Mounted inventory exposes parent paths, not provider parent IDs.",
        },
        checksum: {
          availability: "unavailable",
          reason: "Mounted audits do not read academic file contents.",
        },
        shortcutTarget:
          kind === "symlink"
            ? {
                availability: "unavailable",
                reason: "Mounted inventory does not follow symbolic links.",
              }
            : { availability: "not-applicable" },
        trashed: {
          availability: "unavailable",
          reason: "Mounted inventory does not expose Drive trash state.",
        },
        modifiedAt: {
          availability: "observed",
          value: metadata.mtime.toISOString(),
        },
        size:
          kind === "file"
            ? { availability: "observed", value: metadata.size }
            : { availability: "not-applicable" },
      },
    });
    if (kind === "directory") {
      inventory.push(...(await inventoryDirectory(root, relativePath)));
    }
  }

  return inventory;
}
