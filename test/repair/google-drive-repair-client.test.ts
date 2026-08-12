import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGoogleDriveRepairClient,
  DRIVE_REPAIR_SCOPE,
  type RepairDriveHttpRequest,
} from "../../src/repair/index.js";

test("uses paginated ID metadata and exposes copy, create, move, download and export without delete", async () => {
  const requests: RepairDriveHttpRequest[] = [];
  const client = createGoogleDriveRepairClient({
    request: async (request) => {
      requests.push(request);
      if (request.url.endsWith("/module-id")) {
        return {
          data: {
            id: "module-id",
            name: "ZZ9999",
            mimeType: "application/vnd.google-apps.folder",
            parents: ["semester-id"],
            modifiedTime: "2026-08-12T00:00:00.000Z",
            version: "1",
            capabilities: { canListChildren: true, canAddChildren: true },
          },
        };
      }
      if (request.url.endsWith("/item-id") && request.method === "GET") {
        return {
          data: {
            id: "item-id",
            name: "old.pdf",
            mimeType: "application/pdf",
            parents: ["old-parent"],
            modifiedTime: "2026-08-12T00:00:00.000Z",
            version: "3",
            capabilities: {
              canCopy: true,
              canDownload: true,
              canEdit: true,
              canMoveItemWithinDrive: true,
            },
          },
        };
      }
      if (request.method === "GET" && request.url.endsWith("/files")) {
        return {
          data: {
            files: [],
            ...(request.params?.pageToken === undefined
              ? { nextPageToken: "next" }
              : {}),
          },
        };
      }
      if (request.url.includes("/copy")) {
        return {
          data: {
            id: "backup-file",
            name: "notes.pdf",
            mimeType: "application/pdf",
            md5Checksum: "abc",
          },
        };
      }
      if (request.method === "PATCH") {
        return {
          data: {
            id: "item-id",
            name: "renamed.pdf",
            mimeType: "application/pdf",
            parents: ["new-parent"],
            modifiedTime: "2026-08-12T00:01:00.000Z",
            version: "4",
            capabilities: {
              canCopy: true,
              canDownload: true,
              canEdit: true,
              canMoveItemWithinDrive: true,
            },
          },
        };
      }
      if (request.responseType === "arraybuffer") {
        return { data: Buffer.from("bytes") };
      }
      return {
        data: {
          id: "created-folder",
          name: "Canonical",
          mimeType: "application/vnd.google-apps.folder",
        },
      };
    },
  });

  const inventory = await client.inventory("module-id");
  await client.copyFile({
    operationId: "recovery:file-id",
    sourceId: "file-id",
    parentId: "backup-parent",
    name: "notes.pdf",
    changeSetId: "change-set",
  });
  await client.createFolder({
    operationId: "recovery:folder-id",
    sourceId: "folder-id",
    parentId: "backup-parent",
    name: "Canonical",
    changeSetId: "change-set",
  });
  await client.relocateItem({
    operationId: "move-item",
    sourceId: "item-id",
    parentId: "new-parent",
    name: "renamed.pdf",
    changeSetId: "change-set",
    expectedParentIds: ["old-parent"],
    expectedModifiedTime: "2026-08-12T00:00:00.000Z",
    expectedVersion: "3",
  });
  const blob = await client.readBytes({
    id: "file-id",
    name: "notes.pdf",
    mimeType: "application/pdf",
    parentIds: ["module-id"],
    modifiedTime: "2026-08-12T00:00:00.000Z",
    version: "1",
    capabilities: { canCopy: true, canDownload: true },
  });

  assert.equal(DRIVE_REPAIR_SCOPE, "https://www.googleapis.com/auth/drive");
  assert.equal(inventory.complete, true);
  assert.equal(blob.bytes.toString(), Buffer.from("bytes").toString());
  assert.equal(
    requests.filter(
      ({ method, url }) => method === "GET" && url.endsWith("/files"),
    ).length,
    2,
  );
  assert.ok(
    requests.some(
      ({ method, url, params }) =>
        method === "PATCH" &&
        url.endsWith("/item-id") &&
        params?.addParents === "new-parent" &&
        params.removeParents === "old-parent",
    ),
  );
  assert.equal(Object.keys(client).includes("deleteFile"), false);
  assert.deepEqual([...new Set(requests.map(({ method }) => method))].sort(), [
    "GET",
    "PATCH",
    "POST",
  ]);
});
