import { randomUUID } from "node:crypto";

import { GoogleAuth } from "google-auth-library";

import type {
  RepairDriveOperationInput,
  RepairExecutionDrive,
  RepairJournalEvent,
  RepairOperationResult,
  RepairRelocateInput,
} from "./execute-repair.js";
import { RepairPlanError } from "./plan-repair.js";
import {
  inspectRepairContinuation,
  verifyRepairProjection,
} from "./inspect-repair-continuation.js";
import type { RepairRecoveryDrive } from "./recover-repair.js";
import type {
  CompleteRepairInventory,
  RepairInventoryItem,
  RepairPlan,
} from "./types.js";
import { verifyRepairConformance } from "./verify-repair-conformance.js";

export const DRIVE_REPAIR_SCOPE = "https://www.googleapis.com/auth/drive";
const driveFilesUrl = "https://www.googleapis.com/drive/v3/files";
const driveUploadUrl = "https://www.googleapis.com/upload/drive/v3/files";
const folderMimeType = "application/vnd.google-apps.folder";
const fileFields =
  "id,name,mimeType,parents,modifiedTime,size,md5Checksum,trashed,version,appProperties,capabilities(canAddChildren,canCopy,canDownload,canEdit,canListChildren,canMoveItemWithinDrive)";

export interface RepairDriveHttpRequest {
  url: string;
  method: "GET" | "POST" | "PATCH";
  params?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
  headers?: Record<string, string>;
  responseType?: "json" | "arraybuffer";
}

export interface RepairDriveHttpRequester {
  request(request: RepairDriveHttpRequest): Promise<{ data: unknown }>;
}

export interface GoogleDriveRepairClient
  extends Omit<
      RepairExecutionDrive,
      "verifyContinuation" | "verifyPostcondition"
    >,
    RepairRecoveryDrive {
  verifyContinuation(
    plan: RepairPlan,
    events: RepairJournalEvent[],
    inventory: CompleteRepairInventory,
  ): Promise<{
    blockers: string[];
    recovered: Array<{
      operationId: string;
      result: RepairOperationResult;
    }>;
  }>;
  verifyPostcondition(
    plan: RepairPlan,
    events: RepairJournalEvent[],
  ): Promise<string[]>;
}

export function createGoogleDriveRepairClient(
  requester: RepairDriveHttpRequester = defaultRequester(),
): GoogleDriveRepairClient {
  const getItem = async (id: string): Promise<RepairInventoryItem> =>
    normalizeItem(
      await requestData(requester, {
        url: `${driveFilesUrl}/${encodeURIComponent(id)}`,
        method: "GET",
        params: { fields: fileFields, supportsAllDrives: true },
      }),
    );
  const readBytes = async (item: RepairInventoryItem) => {
    const exportMimeType = exportMimeTypeFor(item.mimeType);
    const data = await requestData(requester, {
      url:
        exportMimeType === undefined
          ? `${driveFilesUrl}/${encodeURIComponent(item.id)}`
          : `${driveFilesUrl}/${encodeURIComponent(item.id)}/export`,
      method: "GET",
      params:
        exportMimeType === undefined
          ? { alt: "media", supportsAllDrives: true }
          : { mimeType: exportMimeType },
      responseType: "arraybuffer",
    });
    return {
      bytes: bytesFromResponse(data),
      ...(exportMimeType === undefined ? {} : { exportMimeType }),
    };
  };
  return {
    inventory: async (rootId) =>
      await inventoryRepairTree(rootId, requester, getItem),
    createFolder: async (input) =>
      normalizeWriteResult(
        await requestData(requester, {
          url: driveFilesUrl,
          method: "POST",
          params: { fields: fileFields, supportsAllDrives: true },
          data: {
            name: input.name,
            mimeType: folderMimeType,
            parents: [input.parentId],
            appProperties: operationProperties(input),
          },
        }),
      ),
    copyFile: async (input) =>
      normalizeWriteResult(
        await requestData(requester, {
          url: `${driveFilesUrl}/${encodeURIComponent(requiredSourceId(input))}/copy`,
          method: "POST",
          params: { fields: fileFields, supportsAllDrives: true },
          data: {
            name: input.name,
            parents: [input.parentId],
            appProperties: operationProperties(input),
          },
        }),
      ),
    findByOperation: async ({ parentId, changeSetId, operationId }) => {
      const found: RepairOperationResult[] = [];
      let pageToken: string | undefined;
      do {
        const data = asRecord(
          await requestData(requester, {
            url: driveFilesUrl,
            method: "GET",
            params: {
              q: `'${escapeQuery(parentId)}' in parents and appProperties has { key='academicOsChangeSet' and value='${escapeQuery(changeSetId)}' } and appProperties has { key='academicOsOperation' and value='${escapeQuery(operationId)}' }`,
              pageSize: 1000,
              ...(pageToken === undefined ? {} : { pageToken }),
              spaces: "drive",
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
              fields: `nextPageToken,incompleteSearch,files(${fileFields})`,
            },
          }),
        );
        if (data.incompleteSearch === true || !Array.isArray(data.files)) {
          throw new RepairPlanError("Drive recovery lookup was incomplete.");
        }
        found.push(
          ...data.files.map((value) => {
            const item = normalizeItem(value);
            return {
              itemId: item.id,
              parentId: requiredSingleParent(item),
              name: item.name,
              mimeType: item.mimeType,
              ...(item.md5Checksum === undefined
                ? {}
                : { md5Checksum: item.md5Checksum }),
            };
          }),
        );
        pageToken =
          typeof data.nextPageToken === "string"
            ? data.nextPageToken
            : undefined;
      } while (pageToken !== undefined);
      return found;
    },
    createFile: async (input) => {
      const boundary = `academic-os-${randomUUID()}`;
      const metadata = {
        name: input.name,
        parents: [input.parentId],
        appProperties: operationProperties(input),
      };
      const body = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${input.mimeType}`,
        "",
        input.contents,
        `--${boundary}--`,
        "",
      ].join("\r\n");
      const created = normalizeItem(
        await requestData(requester, {
          url: driveUploadUrl,
          method: "POST",
          params: {
            uploadType: "multipart",
            fields: fileFields,
            supportsAllDrives: true,
          },
          headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          data: body,
        }),
      );
      return {
        itemId: created.id,
        parentId: requiredSingleParent(created),
        name: created.name,
        mimeType: created.mimeType,
        ...(created.md5Checksum === undefined
          ? {}
          : { md5Checksum: created.md5Checksum }),
      };
    },
    relocateItem: async (input) => {
      const current = await getItem(input.sourceId);
      verifyRelocationPreconditions(current, input);
      const moved = normalizeItem(
        await requestData(requester, {
          url: `${driveFilesUrl}/${encodeURIComponent(input.sourceId)}`,
          method: "PATCH",
          params: {
            addParents: input.parentId,
            removeParents: input.expectedParentIds.join(","),
            fields: fileFields,
            supportsAllDrives: true,
          },
          data: {
            name: input.name,
            appProperties: operationProperties(input),
          },
        }),
      );
      return {
        itemId: moved.id,
        parentId: requiredSingleParent(moved),
        name: moved.name,
        mimeType: moved.mimeType,
        ...(moved.md5Checksum === undefined
          ? {}
          : { md5Checksum: moved.md5Checksum }),
      };
    },
    readBytes,
    verifyContinuation: async (plan, events, inventory) =>
      await inspectRepairContinuation(plan, events, inventory, getItem),
    verifyPostcondition: async (plan, events) => {
      const inventory = await inventoryRepairTree(
        plan.module.rootId,
        requester,
        getItem,
      );
      return [
        ...(await verifyRepairProjection(plan, events, inventory, getItem)),
        ...(await verifyRepairConformance(plan, inventory, readBytes)),
      ];
    },
  };
}

async function inventoryRepairTree(
  rootId: string,
  requester: RepairDriveHttpRequester,
  getItem: (id: string) => Promise<RepairInventoryItem>,
): Promise<CompleteRepairInventory> {
  const root = await getItem(rootId);
  if (root.mimeType !== folderMimeType) {
    throw new RepairPlanError("Repair inventory root is not a folder.");
  }
  const items = [root];
  const folders = [root];
  for (let index = 0; index < folders.length; index += 1) {
    const folder = folders[index];
    if (folder === undefined) continue;
    const pageTokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      const data = asRecord(
        await requestData(requester, {
          url: driveFilesUrl,
          method: "GET",
          params: {
            q: `'${escapeQuery(folder.id)}' in parents`,
            pageSize: 1000,
            ...(pageToken === undefined ? {} : { pageToken }),
            spaces: "drive",
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            fields: `nextPageToken,incompleteSearch,files(${fileFields})`,
          },
        }),
      );
      if (data.incompleteSearch === true || !Array.isArray(data.files)) {
        throw new RepairPlanError("Drive returned a partial repair inventory.");
      }
      for (const value of data.files) {
        const item = normalizeItem(value);
        if (asRecord(value).trashed === true) continue;
        items.push(item);
        if (item.mimeType === folderMimeType) folders.push(item);
      }
      pageToken =
        typeof data.nextPageToken === "string" ? data.nextPageToken : undefined;
      if (pageToken !== undefined) {
        if (pageTokens.has(pageToken)) {
          throw new RepairPlanError(
            "Drive repeated a repair inventory page token.",
          );
        }
        pageTokens.add(pageToken);
      }
    } while (pageToken !== undefined);
  }
  rejectDuplicateIdsAndNames(items);
  return {
    complete: true,
    observedAt: new Date().toISOString(),
    rootId,
    items,
    localArtifacts: [],
  };
}

function normalizeItem(value: unknown): RepairInventoryItem {
  const item = asRecord(value);
  const capabilities = asRecord(item.capabilities);
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.mimeType !== "string" ||
    !Array.isArray(item.parents) ||
    !item.parents.every((parent) => typeof parent === "string") ||
    typeof item.modifiedTime !== "string" ||
    (typeof item.version !== "string" && typeof item.version !== "number")
  ) {
    throw new RepairPlanError("Drive repair metadata is incomplete.");
  }
  return {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    parentIds: item.parents,
    modifiedTime: item.modifiedTime,
    version: String(item.version),
    ...(typeof item.size === "string" ? { size: item.size } : {}),
    ...(typeof item.md5Checksum === "string"
      ? { md5Checksum: item.md5Checksum }
      : {}),
    capabilities: {
      ...(capabilities.canAddChildren === true ? { canAddChildren: true } : {}),
      ...(capabilities.canCopy === true ? { canCopy: true } : {}),
      ...(capabilities.canDownload === true ? { canDownload: true } : {}),
      ...(capabilities.canEdit === true ? { canEdit: true } : {}),
      ...(capabilities.canListChildren === true
        ? { canListChildren: true }
        : {}),
      ...(capabilities.canMoveItemWithinDrive === true
        ? { canMoveItemWithinDrive: true }
        : {}),
    },
    ...(isStringRecord(item.appProperties)
      ? { appProperties: item.appProperties }
      : {}),
  };
}

function normalizeWriteResult(value: unknown): RepairOperationResult {
  const item = asRecord(value);
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.mimeType !== "string"
  ) {
    throw new RepairPlanError(
      "Drive repair write returned incomplete metadata.",
    );
  }
  return {
    itemId: item.id,
    parentId:
      Array.isArray(item.parents) && typeof item.parents[0] === "string"
        ? item.parents[0]
        : "unavailable-during-recovery-copy",
    name: item.name,
    mimeType: item.mimeType,
    ...(typeof item.md5Checksum === "string"
      ? { md5Checksum: item.md5Checksum }
      : {}),
  };
}

function verifyRelocationPreconditions(
  item: RepairInventoryItem,
  input: RepairRelocateInput,
): void {
  if (
    item.modifiedTime !== input.expectedModifiedTime ||
    item.version !== input.expectedVersion ||
    [...item.parentIds].sort().join("\0") !==
      [...input.expectedParentIds].sort().join("\0") ||
    item.capabilities.canEdit !== true ||
    item.capabilities.canMoveItemWithinDrive !== true
  ) {
    throw new RepairPlanError(
      `Drive item ${item.id} changed or cannot be moved safely.`,
    );
  }
}

function operationProperties(
  input: RepairDriveOperationInput,
): Record<string, string> {
  return {
    academicOsChangeSet: input.changeSetId,
    academicOsOperation: input.operationId,
    ...(input.sourceId === undefined
      ? {}
      : { academicOsSource: input.sourceId }),
  };
}

function exportMimeTypeFor(mimeType: string): string | undefined {
  const exports: Record<string, string> = {
    "application/vnd.google-apps.document":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.google-apps.spreadsheet":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.google-apps.presentation":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.google-apps.drawing": "image/png",
  };
  if (
    mimeType.startsWith("application/vnd.google-apps.") &&
    mimeType !== folderMimeType
  ) {
    const exportMimeType = exports[mimeType];
    if (exportMimeType === undefined) {
      throw new RepairPlanError(
        `Unsupported Google-native recovery type: ${mimeType}.`,
      );
    }
    return exportMimeType;
  }
  return undefined;
}

function rejectDuplicateIdsAndNames(items: RepairInventoryItem[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id))
      throw new RepairPlanError("Drive returned a duplicate item ID.");
    ids.add(item.id);
    const key = `${[...item.parentIds].sort().join(",")}\0${item.name.normalize("NFC").toLocaleLowerCase("en-US")}`;
    if (names.has(key)) {
      throw new RepairPlanError(
        "Drive returned duplicate or case-variant names under one parent.",
      );
    }
    names.add(key);
  }
}

function requiredSingleParent(item: RepairInventoryItem): string {
  if (item.parentIds.length !== 1) {
    throw new RepairPlanError(
      `Drive item ${item.id} lacks one parent after repair.`,
    );
  }
  return item.parentIds[0] as string;
}

function requiredSourceId(input: RepairDriveOperationInput): string {
  if (input.sourceId === undefined || input.sourceId.trim() === "") {
    throw new RepairPlanError("Drive recovery copy requires a source item ID.");
  }
  return input.sourceId;
}

function bytesFromResponse(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new RepairPlanError("Drive byte response was not binary.");
}

function escapeQuery(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function requestData(
  requester: RepairDriveHttpRequester,
  request: RepairDriveHttpRequest,
): Promise<unknown> {
  try {
    return (await requester.request(request)).data;
  } catch {
    throw new RepairPlanError(
      "Drive repair request failed without exposing private response data.",
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RepairPlanError("Drive repair response is not an object.");
  }
  return value as Record<string, unknown>;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((child) => typeof child === "string")
  );
}

function defaultRequester(): RepairDriveHttpRequester {
  const auth = new GoogleAuth({ scopes: [DRIVE_REPAIR_SCOPE] });
  return {
    request: async (request) => {
      const response = await auth.request(
        request as Parameters<typeof auth.request>[0],
      );
      return { data: response.data };
    },
  };
}
