import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

import {
  type RepairRecovery,
  verifyRepairRecovery,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

const executeFile = promisify(execFile);
const roots: string[] = [];
const binary = Buffer.from([0, 255, 128, 195, 40, 10]);
const sha256 = createHash("sha256").update(binary).digest("hex");
const drive = {
  inventory: async () => {
    const inventory = repairPlanDraft().inventory;
    inventory.items.push({ ...inventory.items[0]!, id: "retirement" });
    return inventory;
  },
};

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (process.platform === "darwin")
      await executeFile("/usr/bin/chflags", ["-R", "nouchg", root]);
    await chmod(root, 0o755);
    await chmod(join(root, "local-only"), 0o755);
    await rm(root, { recursive: true, force: true });
  }
});

async function snapshot(): Promise<RepairRecovery> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-verify-snapshot-"));
  roots.push(root);
  await mkdir(join(root, "local-only"));
  await writeFile(join(root, "book.pdf"), binary);
  await writeFile(join(root, "local-only", "metadata.bin"), binary);
  const recovery: RepairRecovery = {
    drive: {
      changeSetId: "change",
      planDigest: "plan",
      recoveryRootId: "recovery",
      retirementRootId: "retirement",
      items: [],
      verified: true,
    },
    bytes: {
      changeSetId: "change",
      planDigest: "plan",
      path: root,
      items: [
        {
          sourceId: "source",
          relativePath: "book.pdf",
          sha256,
          size: binary.length,
        },
      ],
      localArtifacts: [
        {
          relativePath: "metadata.bin",
          device: "1",
          inode: "2",
          size: String(binary.length),
          modifiedTime: "1",
          sha256,
        },
      ],
      protection: "read-only-and-user-immutable",
      verified: true,
    },
  };
  await writeFile(join(root, "manifest.json"), JSON.stringify(recovery.bytes));
  return recovery;
}

async function protect(root: string): Promise<void> {
  for (const path of ["book.pdf", "local-only/metadata.bin", "manifest.json"])
    await chmod(join(root, path), 0o444);
  await chmod(join(root, "local-only"), 0o555);
  await chmod(root, 0o555);
  if (process.platform === "darwin")
    await executeFile("/usr/bin/chflags", ["-R", "uchg", root]);
}

test("verifies binary snapshot and local-only checksums and protection", async () => {
  const recovery = await snapshot();
  await protect(recovery.bytes.path);
  await verifyRepairRecovery(recovery, drive);
});

test("rejects a same-sized byte snapshot whose checksum changed", async () => {
  const recovery = await snapshot();
  await writeFile(
    join(recovery.bytes.path, "book.pdf"),
    Buffer.alloc(binary.length),
  );
  await assert.rejects(
    verifyRepairRecovery(recovery, drive),
    /Byte recovery copy no longer verifies: book.pdf/u,
  );
});

test("rejects an incorrect snapshot size even when its checksum matches", async () => {
  const recovery = await snapshot();
  recovery.bytes.items[0]!.size += 1;
  await assert.rejects(
    verifyRepairRecovery(recovery, drive),
    /Byte recovery copy no longer verifies: book.pdf/u,
  );
});

test("rejects incorrect local-only size and checksum", async () => {
  for (const field of ["size", "sha256"] as const) {
    const recovery = await snapshot();
    recovery.bytes.localArtifacts[0]![field] =
      field === "size" ? "999" : "a".repeat(64);
    await assert.rejects(
      verifyRepairRecovery(recovery, drive),
      /Local-only recovery no longer verifies: metadata.bin/u,
    );
  }
});

test("refuses a snapshot file replaced by a symbolic link", async () => {
  const recovery = await snapshot();
  const path = join(recovery.bytes.path, "book.pdf");
  await rm(path);
  await symlink(join(recovery.bytes.path, "local-only", "metadata.bin"), path);
  await assert.rejects(
    verifyRepairRecovery(recovery, drive),
    /Byte recovery copy no longer verifies: book.pdf/u,
  );
});

test("refuses symbolic-link ancestors before reading local-only snapshots", async () => {
  const recovery = await snapshot();
  await rm(join(recovery.bytes.path, "local-only"), { recursive: true });
  await symlink(
    recovery.bytes.path,
    join(recovery.bytes.path, "local-only"),
    "dir",
  );
  await assert.rejects(
    verifyRepairRecovery(recovery, drive),
    /Local-only recovery no longer verifies: metadata.bin/u,
  );
});

test("refuses an extra symbolic link when checking snapshot protection", async () => {
  const recovery = await snapshot();
  await protect(recovery.bytes.path);
  if (process.platform === "darwin")
    await executeFile("/usr/bin/chflags", ["nouchg", recovery.bytes.path]);
  await chmod(recovery.bytes.path, 0o755);
  await symlink(recovery.bytes.path, join(recovery.bytes.path, "cycle"), "dir");
  await chmod(recovery.bytes.path, 0o555);
  if (process.platform === "darwin")
    await executeFile("/usr/bin/chflags", ["uchg", recovery.bytes.path]);
  await assert.rejects(
    verifyRepairRecovery(recovery, drive),
    /not an ordinary file or directory/u,
  );
});
