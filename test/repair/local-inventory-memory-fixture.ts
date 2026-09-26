import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inventoryLocalRepairArtifacts } from "../../src/repair/inventory-local-artifacts.js";
import { repairPlanDraft } from "./fixtures.js";

const root = await mkdtemp(join(tmpdir(), "academic-os-local-memory-"));
const fileSize = 128 * 1024 * 1024;
try {
  const handle = await open(join(root, "recording.bin"), "w");
  try {
    await handle.truncate(fileSize);
  } finally {
    await handle.close();
  }
  const digest = createHash("sha256");
  const zeroes = Buffer.alloc(1024 * 1024);
  for (let index = 0; index < 128; index++) digest.update(zeroes);
  const expected = digest.digest("hex");
  const baseline = process.memoryUsage().external;
  let peak = baseline;
  const sample = () => {
    peak = Math.max(peak, process.memoryUsage().external);
  };
  const sampling = setInterval(sample, 1);
  try {
    const [artifact] = await inventoryLocalRepairArtifacts(
      root,
      repairPlanDraft().inventory,
    );
    sample();
    assert.equal(artifact?.size, String(fileSize));
    assert.equal(artifact?.sha256, expected);
  } finally {
    clearInterval(sampling);
  }
  const peakExternalGrowth = peak - baseline;
  assert.ok(
    peakExternalGrowth < 2 * 1024 * 1024,
    `Fingerprint buffered ${peakExternalGrowth} bytes for a ${fileSize}-byte file.`,
  );
  console.log(JSON.stringify({ fileSize, peakExternalGrowth }));
} finally {
  await rm(root, { recursive: true, force: true });
}
