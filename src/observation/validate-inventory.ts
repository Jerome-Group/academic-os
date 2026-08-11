import type {
  Inventory,
  InventoryProviderMetadata,
  MetadataEvidence,
} from "../conformance/types.js";
import { isIsoTimestamp, isRecord } from "./validation-primitives.js";

const inventoryEntryKinds = new Set(["directory", "file", "symlink", "other"]);
const diagnosticKinds = new Set([
  "duplicate-visible-name",
  "pagination-failure",
  "rate-limit",
  "shortcut-cycle",
  "unavailable-metadata",
]);

export function isInventory(
  value: unknown,
  moduleCode: string,
): value is Inventory {
  return (
    isRecord(value) &&
    value.moduleCode === moduleCode &&
    Array.isArray(value.entries) &&
    value.entries.every(isInventoryEntry) &&
    (value.excludedEntries === undefined ||
      (Array.isArray(value.excludedEntries) &&
        value.excludedEntries.every(isInventoryEntry))) &&
    (value.provenance === undefined || isInventoryProvenance(value.provenance))
  );
}

function isInventoryEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    inventoryEntryKinds.has(String(value.kind)) &&
    (value.size === undefined || isNonnegativeInteger(value.size)) &&
    (value.modifiedAt === undefined || isIsoTimestamp(value.modifiedAt)) &&
    (value.providerMetadata === undefined ||
      isProviderMetadata(value.providerMetadata))
  );
}

function isInventoryProvenance(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["mounted", "drive-api", "synthetic"].includes(String(value.source)) &&
    typeof value.target === "string" &&
    ["complete", "partial"].includes(String(value.completeness)) &&
    Array.isArray(value.diagnostics) &&
    isNonnegativeInteger(value.excludedTrashedItems) &&
    value.diagnostics.every(
      (diagnostic) =>
        isRecord(diagnostic) &&
        diagnosticKinds.has(String(diagnostic.kind)) &&
        ["warning", "error"].includes(String(diagnostic.severity)) &&
        typeof diagnostic.evidence === "string",
    )
  );
}

function isProviderMetadata(
  value: unknown,
): value is InventoryProviderMetadata {
  return (
    isRecord(value) &&
    isEvidence(value.itemId, (itemId) => typeof itemId === "string") &&
    isEvidence(
      value.parentIds,
      (parentIds) =>
        Array.isArray(parentIds) &&
        parentIds.every((parentId) => typeof parentId === "string"),
    ) &&
    isEvidence(
      value.checksum,
      (checksum) =>
        isRecord(checksum) &&
        checksum.algorithm === "md5" &&
        typeof checksum.value === "string",
    ) &&
    isEvidence(
      value.shortcutTarget,
      (target) =>
        isRecord(target) &&
        typeof target.itemId === "string" &&
        isEvidence(target.mimeType, (mimeType) => typeof mimeType === "string"),
    ) &&
    isEvidence(value.trashed, (trashed) => typeof trashed === "boolean") &&
    isEvidence(value.modifiedAt, isIsoTimestamp) &&
    isEvidence(value.size, isNonnegativeInteger)
  );
}

function isEvidence<T>(
  value: unknown,
  isObservedValue: (observed: unknown) => boolean,
): value is MetadataEvidence<T> {
  if (!isRecord(value)) return false;
  if (value.availability === "not-applicable") return true;
  if (value.availability === "unavailable") {
    return typeof value.reason === "string";
  }
  return value.availability === "observed" && isObservedValue(value.value);
}

function isNonnegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
