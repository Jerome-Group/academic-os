import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { inventoryLocalRepairArtifacts } from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-local-inventory-"));
  temporaryRoots.push(root);
  return root;
}

test("discovers the complete local-only artifact set independently", async () => {
  const root = await temporaryRoot();
  const draft = repairPlanDraft();
  await mkdir(join(root, "001 Source Material"), { recursive: true });
  await writeFile(
    join(root, "001 Source Material", "ZZ9999 Source A.pdf"),
    "Drive-backed placeholder",
  );
  await writeFile(join(root, ".DS_Store"), "finder metadata");
  await writeFile(join(root, "Icon\r"), "");

  const artifacts = await inventoryLocalRepairArtifacts(root, draft.inventory);

  assert.deepEqual(
    artifacts.map(({ relativePath }) => relativePath),
    [".DS_Store", "Icon\r"],
  );
  assert.equal(
    artifacts.every(({ sha256 }) => /^[0-9a-f]{64}$/u.test(sha256)),
    true,
  );
});

test("hashes binary local artifacts without text decoding", async () => {
  const root = await temporaryRoot();
  const bytes = Buffer.from([0, 255, 128, 195, 40, 10]);
  await writeFile(join(root, "binary.pdf"), bytes);

  const [artifact] = await inventoryLocalRepairArtifacts(
    root,
    repairPlanDraft().inventory,
  );

  assert.equal(
    artifact?.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(artifact?.size, String(bytes.length));
});

test("fingerprints a large local artifact with bounded memory", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(
      new URL("./local-inventory-memory-fixture.js", import.meta.url),
    ),
  ]);
  const measurements: { fileSize: number; peakExternalGrowth: number } =
    JSON.parse(stdout);
  assert.ok(measurements.peakExternalGrowth < 2 * 1024 * 1024);
});

test("refuses a local artifact symlink", async () => {
  const root = await temporaryRoot();
  await writeFile(join(root, "book.pdf"), "synthetic book");
  await symlink(join(root, "book.pdf"), join(root, "linked.pdf"));

  await assert.rejects(
    inventoryLocalRepairArtifacts(root, repairPlanDraft().inventory),
    /contains a symlink/u,
  );
});
