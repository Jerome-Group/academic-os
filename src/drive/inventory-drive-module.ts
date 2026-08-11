import { inventoryDiagnostics } from "./drive-inventory-diagnostics.js";
import { listDriveTree } from "./list-drive-tree.js";
import { normalizeDriveEntries } from "./normalize-drive-inventory.js";
import type {
  DriveFilesClient,
  DriveInventory,
  DriveInventoryOptions,
  DriveInventoryTarget,
} from "./types.js";

export async function inventoryDriveModule(
  target: DriveInventoryTarget,
  client: DriveFilesClient,
  options: DriveInventoryOptions = {},
): Promise<DriveInventory> {
  const listed = await listDriveTree(target.moduleFolderId, client, options);
  const diagnostics = inventoryDiagnostics(listed.items, listed.diagnostics);
  const { entries, excludedEntries } = normalizeDriveEntries(listed.items);
  return {
    moduleCode: target.moduleCode,
    entries,
    excludedEntries,
    provenance: {
      source: "drive-api",
      target: target.moduleFolderId,
      completeness: diagnostics.some(({ severity }) => severity === "error")
        ? "partial"
        : "complete",
      diagnostics,
      excludedTrashedItems: excludedEntries.length,
    },
  };
}
