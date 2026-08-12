import { RepairPlanError } from "./repair-plan-error.js";
import type { CompleteRepairInventory } from "./types.js";

export function repairInventoryPaths(
  inventory: CompleteRepairInventory,
): Map<string, string> {
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  const paths = new Map<string, string>([[inventory.rootId, ""]]);
  const visiting = new Set<string>();
  const resolve = (id: string): string => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const item = items.get(id);
    if (item === undefined || visiting.has(id)) {
      throw new RepairPlanError("Repair inventory is disconnected or cyclic.");
    }
    visiting.add(id);
    const parents = item.parentIds.filter((parentId) => items.has(parentId));
    if (parents.length !== 1) {
      throw new RepairPlanError(
        `Drive item ${item.id} lacks one unambiguous in-tree parent.`,
      );
    }
    const parentPath = resolve(parents[0] as string);
    const path = parentPath === "" ? item.name : `${parentPath}/${item.name}`;
    visiting.delete(id);
    paths.set(id, path);
    return path;
  };
  for (const item of items.values()) resolve(item.id);
  return paths;
}
