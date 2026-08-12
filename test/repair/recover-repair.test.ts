import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createRepairPlan,
  recoverRepairPlan,
  repairApprovalDigest,
  type RepairRecoveryDrive,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

test("verifies Drive copies and a protected byte snapshot before repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-repair-"));
  const calls: string[] = [];
  const drive: RepairRecoveryDrive = {
    findByOperation: async () => [],
    createFolder: async ({ name, parentId, sourceId }) => {
      calls.push(`folder:${sourceId}:${parentId}:${name}`);
      return {
        itemId: `backup-${sourceId}`,
        parentId,
        name,
        mimeType: "application/vnd.google-apps.folder",
      };
    },
    copyFile: async ({ name, parentId, sourceId }) => {
      calls.push(`file:${sourceId}:${parentId}:${name}`);
      return {
        itemId: `backup-${sourceId}`,
        parentId,
        name,
        mimeType: "application/pdf",
        md5Checksum: "0123456789abcdef0123456789abcdef",
      };
    },
    readBytes: async (item) => ({
      bytes: Buffer.from(`bytes:${item.id}`),
    }),
  };
  let protectedPath = "";
  const localBytes = Buffer.from("finder-metadata");
  const draft = repairPlanDraft();
  draft.inventory.localArtifacts.push({
    relativePath: ".DS_Store",
    device: "10",
    inode: "20",
    size: String(localBytes.byteLength),
    modifiedTime: "123456789",
    sha256: createHash("sha256").update(localBytes).digest("hex"),
  });
  draft.approval.approvedPlanDigest = repairApprovalDigest(draft);

  const recovery = await recoverRepairPlan({
    plan: createRepairPlan(draft),
    drive,
    driveRecoveryRootId: "recovery-root-id",
    snapshotRoot: root,
    sourceDevice: "source-device",
    snapshotDevice: "separate-device",
    protectSnapshot: async (path) => {
      protectedPath = path;
    },
    readLocalArtifact: async () => localBytes,
  });

  assert.deepEqual(calls, [
    "folder:change-set:11111111-1111-4111-8111-111111111111:recovery-root-id:11111111-1111-4111-8111-111111111111",
    "folder:module-id:backup-change-set:11111111-1111-4111-8111-111111111111:ZZ9999",
    "folder:legacy-materials-id:backup-module-id:001 Source Material",
    "file:source-id:backup-legacy-materials-id:ZZ9999 Source A.pdf",
    "folder:retirement:11111111-1111-4111-8111-111111111111:backup-change-set:11111111-1111-4111-8111-111111111111:Retired Originals",
  ]);
  assert.equal(recovery.drive.verified, true);
  assert.equal(recovery.bytes.verified, true);
  assert.equal(recovery.drive.items.length, 3);
  assert.equal(recovery.bytes.items.length, 1);
  assert.equal(protectedPath, recovery.bytes.path);
  assert.equal(
    await readFile(
      join(
        recovery.bytes.path,
        "ZZ9999",
        "001 Source Material",
        "ZZ9999 Source A.pdf",
      ),
      "utf8",
    ),
    "bytes:source-id",
  );
  assert.equal(
    (await stat(join(recovery.bytes.path, "manifest.json"))).isFile(),
    true,
  );
  assert.equal(
    await readFile(
      join(recovery.bytes.path, "local-only", ".DS_Store"),
      "utf8",
    ),
    "finder-metadata",
  );
});

test("blocks recovery when the byte snapshot is not on separate storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-repair-device-"));
  const drive: RepairRecoveryDrive = {
    findByOperation: async () => [],
    createFolder: async () => assert.fail("recovery must not start"),
    copyFile: async () => assert.fail("recovery must not start"),
    readBytes: async () => assert.fail("recovery must not start"),
  };
  await assert.rejects(
    recoverRepairPlan({
      plan: createRepairPlan(repairPlanDraft()),
      drive,
      driveRecoveryRootId: "recovery-root-id",
      snapshotRoot: root,
      sourceDevice: "same-device",
      snapshotDevice: "same-device",
    }),
    /separate storage device/u,
  );
});

test("repairs partially protected recovery snapshots idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-protection-"));
  const plan = createRepairPlan(repairPlanDraft());
  const created = new Map<
    string,
    Awaited<ReturnType<RepairRecoveryDrive["createFolder"]>>
  >();
  const drive: RepairRecoveryDrive = {
    findByOperation: async ({ operationId }) => {
      const existing = created.get(operationId);
      return existing === undefined ? [] : [existing];
    },
    createFolder: async ({ operationId, name, parentId, sourceId }) => {
      const result = {
        itemId: `backup-${sourceId}`,
        parentId,
        name,
        mimeType: "application/vnd.google-apps.folder",
      };
      created.set(operationId, result);
      return result;
    },
    copyFile: async ({ operationId, name, parentId, sourceId }) => {
      const result = {
        itemId: `backup-${sourceId}`,
        parentId,
        name,
        mimeType: "application/pdf",
        md5Checksum: "0123456789abcdef0123456789abcdef",
      };
      created.set(operationId, result);
      return result;
    },
    readBytes: async (item) => ({ bytes: Buffer.from(`bytes:${item.id}`) }),
  };
  const input = {
    plan,
    drive,
    driveRecoveryRootId: "recovery-root-id",
    snapshotRoot: root,
    sourceDevice: "source-device",
    snapshotDevice: "separate-device",
  };
  const first = await recoverRepairPlan(input);
  const nested = join(first.bytes.path, "ZZ9999", "001 Source Material");
  const file = join(nested, "ZZ9999 Source A.pdf");
  if (process.platform === "darwin") {
    const { execFile } = await import("node:child_process");
    await new Promise((resolve, reject) =>
      execFile(
        "/usr/bin/chflags",
        ["-R", "nouchg", first.bytes.path],
        (error) => (error === null ? resolve(undefined) : reject(error)),
      ),
    );
    await chmod(nested, 0o755);
    await new Promise((resolve, reject) =>
      execFile("/usr/bin/chflags", ["uchg", first.bytes.path], (error) =>
        error === null ? resolve(undefined) : reject(error),
      ),
    );
  } else {
    await chmod(nested, 0o755);
  }

  const resumed = await recoverRepairPlan(input);
  assert.deepEqual(resumed, first);

  assert.equal((await stat(first.bytes.path)).mode & 0o222, 0);
  assert.equal((await stat(nested)).mode & 0o222, 0);
  assert.equal((await stat(file)).mode & 0o222, 0);
});
