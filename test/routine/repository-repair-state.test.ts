import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readRepositoryRepairStatus } from "../../src/routine/repository-repair-state.js";

test("validates historical cleanup as an exact optional scalar", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-cleanup-enum-"));
  t.after(() => rm(root, { recursive: true }));
  const directory = join(root, "repository-repair");
  const evidence = join(directory, "synthetic");
  await mkdir(directory, { mode: 0o700 });
  await mkdir(evidence, { mode: 0o700 });
  await writeFile(
    join(directory, "state.json"),
    JSON.stringify({ id: "synthetic", stage: "healthy", evidence }),
    { mode: 0o600 },
  );
  const receipt = {
    id: "synthetic",
    observedAt: "2026-10-23T15:00:00.000Z",
    baseline: { passed: true, actions: [{ exitCode: 0 }] },
  };
  for (const candidateCleanup of [undefined, "released", "retained"]) {
    await writeFile(
      join(evidence, "healthy.json"),
      JSON.stringify({ ...receipt, candidateCleanup }),
      { mode: 0o600 },
    );
    const status = await readRepositoryRepairStatus(root);
    assert.equal(status.outcome, "observed");
    assert.equal(status.report?.outcome, "healthy");
    assert.equal(status.report?.candidateCleanup, candidateCleanup);
  }
  for (const candidateCleanup of [
    ["released"],
    ["retained"],
    null,
    false,
    {},
  ]) {
    await writeFile(
      join(evidence, "healthy.json"),
      JSON.stringify({ ...receipt, candidateCleanup }),
      { mode: 0o600 },
    );
    const status = await readRepositoryRepairStatus(root);
    assert.equal(status.outcome, "blocked");
    assert.equal(status.code, "invalid-state-evidence");
    assert.equal(status.report, undefined);
  }
});
