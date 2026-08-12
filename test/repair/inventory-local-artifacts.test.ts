import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { inventoryLocalRepairArtifacts } from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

test("discovers the complete local-only artifact set independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-local-inventory-"));
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
