import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGoogleDriveFilesClient,
  DRIVE_METADATA_READONLY_SCOPE,
  inventoryDriveModule,
  type DriveFilePage,
  type DriveFilesClient,
  type DriveListRequest,
} from "../../src/drive/index.js";
import {
  createAuditObservation,
  isAuditObservation,
} from "../../src/observation/index.js";

class SyntheticDriveClient implements DriveFilesClient {
  readonly requests: DriveListRequest[] = [];

  constructor(private readonly pages: Map<string, DriveFilePage | Error>) {}

  async listFiles(request: DriveListRequest): Promise<DriveFilePage> {
    this.requests.push(request);
    const key = `${request.parentId}:${request.pageToken ?? "first"}`;
    const result = this.pages.get(key) ?? { files: [] };
    if (result instanceof Error) throw result;
    return result;
  }
}

describe("Drive API inventory", () => {
  it("exposes a GET-only metadata client", async () => {
    const requests: unknown[] = [];
    const client = createGoogleDriveFilesClient({
      request: async (request) => {
        requests.push(request);
        return { data: { files: [] } };
      },
    });

    await client.listFiles({ parentId: "folder'id", pageToken: "next" });

    assert.deepEqual(requests, [
      {
        url: "https://www.googleapis.com/drive/v3/files",
        method: "GET",
        params: {
          q: "'folder\\'id' in parents",
          pageToken: "next",
          pageSize: 1000,
          spaces: "drive",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          fields:
            "nextPageToken,incompleteSearch,files(id,name,mimeType,parents,modifiedTime,size,md5Checksum,trashed,shortcutDetails(targetId,targetMimeType))",
        },
      },
    ]);
    assert.deepEqual(Object.keys(client), ["listFiles"]);
  });

  it("redacts private API responses from failures", async () => {
    const client = createGoogleDriveFilesClient({
      request: async () => {
        throw {
          response: {
            status: 403,
            data: {
              privateName: "do-not-leak",
              error: { errors: [{ reason: "rateLimitExceeded" }] },
            },
          },
        };
      },
    });

    await assert.rejects(
      client.listFiles({ parentId: "module-root" }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Drive metadata request failed.");
        assert.equal("status" in error ? error.status : undefined, 403);
        assert.equal(
          "reason" in error ? error.reason : undefined,
          "rateLimitExceeded",
        );
        assert.doesNotMatch(String(error), /do-not-leak/u);
        return true;
      },
    );
  });

  it("uses metadata-only authorization and normalizes every listing page", async () => {
    assert.equal(
      DRIVE_METADATA_READONLY_SCOPE,
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    );
    const client = new SyntheticDriveClient(
      new Map<string, DriveFilePage | Error>([
        [
          "module-root:first",
          {
            files: [
              {
                id: "admin-id",
                name: "00 Module Admin",
                mimeType: "application/vnd.google-apps.folder",
                parents: ["module-root"],
                modifiedTime: "2026-08-12T01:00:00.000Z",
                trashed: false,
              },
            ],
            nextPageToken: "page-2",
          },
        ],
        [
          "module-root:page-2",
          {
            files: [
              {
                id: "notes-id",
                name: "notes.pdf",
                mimeType: "application/pdf",
                parents: ["module-root"],
                modifiedTime: "2026-08-12T02:00:00.000Z",
                size: "42",
                md5Checksum: "abc123",
                trashed: true,
              },
              {
                id: "shortcut-id",
                name: "Admin shortcut",
                mimeType: "application/vnd.google-apps.shortcut",
                parents: ["module-root"],
                shortcutDetails: {
                  targetId: "admin-id",
                  targetMimeType: "application/vnd.google-apps.folder",
                },
                trashed: false,
              },
            ],
          },
        ],
        ["admin-id:first", { files: [] }],
      ]),
    );

    const inventory = await inventoryDriveModule(
      { moduleCode: "MH2100", moduleFolderId: "module-root" },
      client,
    );

    assert.deepEqual(
      client.requests.map(({ parentId, pageToken }) => [parentId, pageToken]),
      [
        ["module-root", undefined],
        ["module-root", "page-2"],
        ["admin-id", undefined],
      ],
    );
    assert.equal(inventory.provenance.source, "drive-api");
    assert.equal(inventory.provenance.completeness, "complete");
    assert.deepEqual(inventory.provenance.diagnostics, []);
    assert.deepEqual(
      inventory.entries.map(({ path, kind }) => [path, kind]),
      [
        ["00 Module Admin", "directory"],
        ["Admin shortcut", "symlink"],
      ],
    );
    assert.equal(inventory.provenance.excludedTrashedItems, 1);
    const file = inventory.excludedEntries?.find(
      ({ path }) => path === "notes.pdf",
    );
    assert.deepEqual(file?.providerMetadata, {
      itemId: { availability: "observed", value: "notes-id" },
      parentIds: { availability: "observed", value: ["module-root"] },
      checksum: {
        availability: "observed",
        value: { algorithm: "md5", value: "abc123" },
      },
      shortcutTarget: { availability: "not-applicable" },
      trashed: { availability: "observed", value: true },
      modifiedAt: {
        availability: "observed",
        value: "2026-08-12T02:00:00.000Z",
      },
      size: { availability: "observed", value: 42 },
    });
    const shortcut = inventory.entries.find(
      ({ path }) => path === "Admin shortcut",
    );
    assert.deepEqual(shortcut?.providerMetadata?.shortcutTarget, {
      availability: "observed",
      value: {
        itemId: "admin-id",
        mimeType: {
          availability: "observed",
          value: "application/vnd.google-apps.folder",
        },
      },
    });
  });

  it("bounds duplicate names, shortcut cycles, and unavailable metadata", async () => {
    const client = new SyntheticDriveClient(
      new Map<string, DriveFilePage | Error>([
        [
          "module-root:first",
          {
            files: [
              {
                id: "shortcut-a",
                name: "Same name",
                mimeType: "application/vnd.google-apps.shortcut",
                parents: ["module-root"],
                shortcutDetails: { targetId: "shortcut-b" },
                trashed: false,
              },
              {
                id: "shortcut-b",
                name: "Same name",
                mimeType: "application/vnd.google-apps.shortcut",
                parents: ["module-root"],
                shortcutDetails: { targetId: "shortcut-a" },
              },
            ],
          },
        ],
      ]),
    );

    const inventory = await inventoryDriveModule(
      { moduleCode: "MH2100", moduleFolderId: "module-root" },
      client,
    );

    assert.equal(inventory.provenance.completeness, "partial");
    assert.deepEqual(
      inventory.provenance.diagnostics.map(({ kind }) => kind),
      ["duplicate-visible-name", "shortcut-cycle"],
    );
    assert.match(
      inventory.provenance.diagnostics[0]?.evidence ?? "",
      /2 items/u,
    );
    const missing = inventory.entries.find(
      ({ providerMetadata }) =>
        providerMetadata?.itemId.availability === "observed" &&
        providerMetadata.itemId.value === "shortcut-b",
    );
    assert.deepEqual(missing?.providerMetadata?.modifiedAt, {
      availability: "unavailable",
      reason: "Drive did not return modifiedTime.",
    });
    assert.deepEqual(missing?.providerMetadata?.trashed, {
      availability: "unavailable",
      reason: "Drive did not return trashed state.",
    });
    assert.deepEqual(missing?.providerMetadata?.shortcutTarget, {
      availability: "observed",
      value: {
        itemId: "shortcut-a",
        mimeType: {
          availability: "unavailable",
          reason: "Drive did not return shortcutDetails.targetMimeType.",
        },
      },
    });
    const observation = createAuditObservation({
      target: {
        moduleCode: "MH2100",
        semester: "Y2S1",
        identity: "module-root",
      },
      inventory,
      findings: [],
      observedAt: "2026-08-12T00:00:00.000Z",
      contractVersion: 2,
    });
    assert.equal(isAuditObservation(observation), true);
    assert.deepEqual(observation.metadataAvailability, {
      contentChecksums: "entry-specific",
      reason:
        "Each Drive inventory entry records whether a provider checksum was observed.",
    });
  });

  it("retains trashed evidence without treating it as visible", async () => {
    const client = new SyntheticDriveClient(
      new Map<string, DriveFilePage | Error>([
        [
          "module-root:first",
          {
            files: [
              {
                id: "live-id",
                name: "same.pdf",
                mimeType: "application/pdf",
                parents: ["module-root"],
                trashed: false,
              },
              {
                id: "trashed-id",
                name: "same.pdf",
                mimeType: "application/pdf",
                parents: ["module-root"],
                trashed: true,
              },
            ],
          },
        ],
      ]),
    );

    const inventory = await inventoryDriveModule(
      { moduleCode: "MH2100", moduleFolderId: "module-root" },
      client,
    );

    assert.equal(inventory.provenance.completeness, "complete");
    assert.equal(inventory.entries.length, 1);
    assert.equal(inventory.excludedEntries?.length, 1);
    assert.equal(inventory.provenance.excludedTrashedItems, 1);
  });

  it("returns bounded evidence after a paginated rate limit", async () => {
    const rateLimit = Object.assign(new Error("private response omitted"), {
      status: 429,
      reason: "rateLimitExceeded",
    });
    const client = new SyntheticDriveClient(
      new Map<string, DriveFilePage | Error>([
        ["module-root:first", { files: [], nextPageToken: "page-2" }],
        ["module-root:page-2", rateLimit],
      ]),
    );

    const inventory = await inventoryDriveModule(
      { moduleCode: "MH2100", moduleFolderId: "module-root" },
      client,
      { maximumAttempts: 2, wait: async () => undefined },
    );

    assert.equal(client.requests.length, 3);
    assert.equal(inventory.provenance.completeness, "partial");
    assert.deepEqual(inventory.provenance.diagnostics, [
      {
        kind: "rate-limit",
        severity: "error",
        evidence:
          "Drive listing stopped at parent module-root after page 1; status 429, reason rateLimitExceeded, 2 attempts.",
      },
    ]);
  });

  it("retries user rate limits as rate-limit evidence", async () => {
    const userRateLimit = Object.assign(new Error("private response omitted"), {
      status: 403,
      reason: "userRateLimitExceeded",
    });
    const client = new SyntheticDriveClient(
      new Map<string, DriveFilePage | Error>([
        ["module-root:first", userRateLimit],
      ]),
    );

    const inventory = await inventoryDriveModule(
      { moduleCode: "MH2100", moduleFolderId: "module-root" },
      client,
      { maximumAttempts: 2, wait: async () => undefined },
    );

    assert.equal(client.requests.length, 2);
    assert.equal(inventory.provenance.diagnostics[0]?.kind, "rate-limit");
  });

  it("stops a repeated pagination token", async () => {
    const client = new SyntheticDriveClient(
      new Map<string, DriveFilePage | Error>([
        ["module-root:first", { files: [], nextPageToken: "repeat" }],
        ["module-root:repeat", { files: [], nextPageToken: "repeat" }],
      ]),
    );

    const inventory = await inventoryDriveModule(
      { moduleCode: "MH2100", moduleFolderId: "module-root" },
      client,
    );

    assert.equal(client.requests.length, 2);
    assert.deepEqual(inventory.provenance.diagnostics, [
      {
        kind: "pagination-failure",
        severity: "error",
        evidence:
          "Drive repeated pagination token repeat for parent module-root after page 2.",
      },
    ]);
  });
});
