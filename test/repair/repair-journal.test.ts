import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createFileRepairJournalStore,
  createRepairPlan,
  type RepairJournalEvent,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

test("refuses non-scalar repair journal event types", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-journal-enum-"));
  t.after(() => rm(root, { recursive: true }));
  const plan = createRepairPlan(repairPlanDraft());
  const directory = join(root, "journals", "repairs");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${plan.changeSetId}.jsonl`);
  const store = createFileRepairJournalStore(root);
  for (const type of [["started"], ["outcome"], null, false, {}]) {
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        sequence: 0,
        recordedAt: "2026-08-12T12:10:00.000Z",
        changeSetId: plan.changeSetId,
        planDigest: plan.planDigest,
        type,
        plan,
      })}\n`,
    );
    await assert.rejects(store.read(plan.changeSetId), /invalid event/u);
  }
});

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
