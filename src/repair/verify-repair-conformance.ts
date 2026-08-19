import {
  auditModule,
  type Inventory,
  type InventoryEntry,
  type ModuleControls,
} from "../conformance/index.js";
import { moduleControlPaths } from "../conformance/control-paths.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import type {
  CompleteRepairInventory,
  RepairInventoryItem,
  RepairPlan,
} from "./types.js";

const folderMimeType = "application/vnd.google-apps.folder";

export async function verifyRepairConformance(
  plan: RepairPlan,
  inventory: CompleteRepairInventory,
  readBytes: (item: RepairInventoryItem) => Promise<{ bytes: Uint8Array }>,
): Promise<string[]> {
  const paths = inventoryPaths(inventory);
  const controls: ModuleControls = {};
  for (const [field, path] of Object.entries(moduleControlPaths)) {
    const item = inventory.items.find(
      (candidate) => paths.get(candidate.id) === path,
    );
    if (item !== undefined && item.mimeType !== folderMimeType) {
      controls[field as keyof ModuleControls] = Buffer.from(
        (await readBytes(item)).bytes,
      ).toString("utf8");
    }
  }
  const result = auditModule(
    {
      moduleCode: plan.module.code,
      semester: plan.module.semester,
      controls,
      inventory: conformanceInventory(plan, inventory, paths),
    },
    await loadModuleContract(),
  );
  return result.outcome === "conformant"
    ? []
    : result.findings
        .filter(({ status }) => !["pass", "not-applicable"].includes(status))
        .map(
          ({ ruleId, path, evidence }) => `${ruleId} at ${path}: ${evidence}`,
        );
}

function conformanceInventory(
  plan: RepairPlan,
  inventory: CompleteRepairInventory,
  paths: Map<string, string>,
): Inventory {
  return {
    moduleCode: plan.module.code,
    entries: inventory.items.flatMap((item): InventoryEntry[] => {
      const path = paths.get(item.id);
      if (path === undefined || path === "") return [];
      return [
        {
          path,
          kind: item.mimeType === folderMimeType ? "directory" : "file",
          ...(item.size === undefined ? {} : { size: Number(item.size) }),
          modifiedAt: item.modifiedTime,
          providerMetadata: {
            itemId: { availability: "observed", value: item.id },
            parentIds: { availability: "observed", value: item.parentIds },
            checksum:
              item.md5Checksum === undefined
                ? {
                    availability: "unavailable",
                    reason: "Drive returned no checksum.",
                  }
                : {
                    availability: "observed",
                    value: { algorithm: "md5", value: item.md5Checksum },
                  },
            shortcutTarget: { availability: "not-applicable" },
            trashed: { availability: "observed", value: false },
            modifiedAt: { availability: "observed", value: item.modifiedTime },
            size:
              item.size === undefined
                ? {
                    availability: "unavailable",
                    reason: "Drive returned no size.",
                  }
                : { availability: "observed", value: Number(item.size) },
          },
        },
      ];
    }),
    provenance: {
      source: "drive-api",
      target: inventory.rootId,
      completeness: "complete",
      diagnostics: [],
      excludedTrashedItems: 0,
    },
  };
}

function inventoryPaths(
  inventory: CompleteRepairInventory,
): Map<string, string> {
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  const paths = new Map<string, string>([[inventory.rootId, ""]]);
  const visiting = new Set<string>();
  const resolve = (id: string): string => {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const item = items.get(id);
    if (item === undefined || visiting.has(id))
      throw new TypeError("Repair inventory is disconnected.");
    visiting.add(id);
    const parents = item.parentIds.filter((parentId) => items.has(parentId));
    if (parents.length !== 1)
      throw new TypeError("Repair inventory lacks one unambiguous parent.");
    const parent = parents[0] as string;
    const parentPath = resolve(parent);
    const path = parentPath === "" ? item.name : `${parentPath}/${item.name}`;
    visiting.delete(id);
    paths.set(id, path);
    return path;
  };
  for (const item of items.values()) resolve(item.id);
  return paths;
}
