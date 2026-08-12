import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createFileRepairJournalStore,
  createRepairPlan,
  type RepairJournalEvent,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

test("persists a private append-only repair journal with strict sequencing", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "academic-os-state-"));
  const plan = createRepairPlan(repairPlanDraft());
  const store = createFileRepairJournalStore(stateRoot);
  const started: RepairJournalEvent = {
    schemaVersion: 1,
    sequence: 0,
    recordedAt: "2026-08-12T12:10:00.000Z",
    changeSetId: plan.changeSetId,
    planDigest: plan.planDigest,
    type: "started",
    plan,
  };

  await store.append(started);
  assert.deepEqual(await store.read(plan.changeSetId), [started]);
  await assert.rejects(store.append({ ...started, sequence: 2 }), /sequence/u);
  const source = await readFile(
    join(stateRoot, "journals", "repairs", `${plan.changeSetId}.jsonl`),
    "utf8",
  );
  assert.equal(source, `${JSON.stringify(started)}\n`);
});
