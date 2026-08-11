import type { InventoryDiagnostic } from "../conformance/index.js";
import {
  folderMimeType,
  type ListedDriveItem,
} from "./drive-inventory-state.js";
import { listDriveFolder } from "./list-drive-folder.js";
import type { DriveFilesClient, DriveInventoryOptions } from "./types.js";

interface FolderToList {
  id: string;
  path: string;
  ancestorIds: string[];
}

export async function listDriveTree(
  rootId: string,
  client: DriveFilesClient,
  options: DriveInventoryOptions,
): Promise<{
  items: ListedDriveItem[];
  diagnostics: InventoryDiagnostic[];
}> {
  const diagnostics: InventoryDiagnostic[] = [];
  const items: ListedDriveItem[] = [];
  const folders: FolderToList[] = [{ id: rootId, path: "", ancestorIds: [] }];

  for (let index = 0; index < folders.length; index += 1) {
    const folder = folders[index];
    if (folder === undefined) continue;
    const files = await listDriveFolder(
      folder.id,
      client,
      options,
      diagnostics,
    );
    for (const file of files) {
      if (file.name === undefined || file.id === undefined) {
        diagnostics.push({
          kind: "unavailable-metadata",
          severity: "error",
          evidence: `Drive returned an item under parent ${folder.id} without both id and name.`,
        });
        continue;
      }
      const path =
        folder.path === "" ? file.name : `${folder.path}/${file.name}`;
      const ancestorIds = [...folder.ancestorIds, folder.id];
      items.push({ file, path, ancestorIds });
      if (file.mimeType === folderMimeType) {
        folders.push({ id: file.id, path, ancestorIds });
      }
    }
  }
  return { items, diagnostics };
}
