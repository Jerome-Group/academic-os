import type {
  InventoryEntry,
  InventoryProviderMetadata,
  MetadataEvidence,
} from "../conformance/index.js";
import {
  folderMimeType,
  type ListedDriveItem,
  shortcutMimeType,
} from "./drive-inventory-state.js";
import type { DriveFile } from "./types.js";

export function normalizeDriveEntries(items: ListedDriveItem[]): {
  entries: InventoryEntry[];
  excludedEntries: InventoryEntry[];
} {
  const normalized = items.map(toInventoryEntry).sort(compareEntries);
  return {
    entries: normalized.filter((entry) => !isTrashedEntry(entry)),
    excludedEntries: normalized.filter(isTrashedEntry),
  };
}

function toInventoryEntry({ file, path }: ListedDriveItem): InventoryEntry {
  const metadata = providerMetadata(file);
  return {
    path,
    kind: inventoryKind(file.mimeType),
    ...(metadata.size.availability === "observed"
      ? { size: metadata.size.value }
      : {}),
    ...(metadata.modifiedAt.availability === "observed"
      ? { modifiedAt: metadata.modifiedAt.value }
      : {}),
    providerMetadata: metadata,
  };
}

function providerMetadata(file: DriveFile): InventoryProviderMetadata {
  const shortcutTarget = file.shortcutDetails?.targetId;
  return {
    itemId: evidence(file.id, "Drive did not return id."),
    parentIds: evidence(file.parents, "Drive did not return parents."),
    checksum: evidence(
      file.md5Checksum === undefined
        ? undefined
        : { algorithm: "md5" as const, value: file.md5Checksum },
      "Drive did not return md5Checksum.",
    ),
    shortcutTarget:
      file.mimeType !== shortcutMimeType
        ? { availability: "not-applicable" }
        : evidence(
            shortcutTarget === undefined
              ? undefined
              : {
                  itemId: shortcutTarget,
                  mimeType: evidence(
                    file.shortcutDetails?.targetMimeType,
                    "Drive did not return shortcutDetails.targetMimeType.",
                  ),
                },
            "Drive did not return shortcutDetails.targetId.",
          ),
    trashed: evidence(file.trashed, "Drive did not return trashed state."),
    modifiedAt: evidence(
      file.modifiedTime,
      "Drive did not return modifiedTime.",
    ),
    size:
      file.mimeType === folderMimeType || file.mimeType === shortcutMimeType
        ? { availability: "not-applicable" }
        : evidence(parseSize(file.size), "Drive did not return a valid size."),
  };
}

function evidence<T>(
  value: T | undefined,
  reason: string,
): MetadataEvidence<T> {
  return value === undefined
    ? { availability: "unavailable", reason }
    : { availability: "observed", value };
}

function parseSize(size: string | undefined): number | undefined {
  if (size === undefined || !/^\d+$/u.test(size)) return undefined;
  const parsed = Number(size);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function inventoryKind(mimeType: string | undefined): InventoryEntry["kind"] {
  if (mimeType === folderMimeType) return "directory";
  if (mimeType === shortcutMimeType) return "symlink";
  return mimeType === undefined ? "other" : "file";
}

function compareEntries(left: InventoryEntry, right: InventoryEntry): number {
  const byPath = left.path.localeCompare(right.path);
  if (byPath !== 0) return byPath;
  return observedItemId(left).localeCompare(observedItemId(right));
}

function observedItemId(entry: InventoryEntry): string {
  const itemId = entry.providerMetadata?.itemId;
  return itemId?.availability === "observed" ? itemId.value : "";
}

function isTrashedEntry(entry: InventoryEntry): boolean {
  const trashed = entry.providerMetadata?.trashed;
  return trashed?.availability === "observed" && trashed.value;
}
