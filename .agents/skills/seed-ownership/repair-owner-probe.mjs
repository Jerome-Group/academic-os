import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [product, destination] = process.argv
  .slice(2)
  .map((path) => resolve(path));
await mkdir(destination, { recursive: true });
const load = (path) => import(pathToFileURL(join(product, "dist", path)).href);
const { createFileRepairJournalStore, createRepairPlan, executeRepairPlan } =
  await load("src/repair/index.js");
const { repairPlanDraft } = await load("test/repair/fixtures.js");
const plan = createRepairPlan(repairPlanDraft());
const journal = createFileRepairJournalStore(destination);
const entered = Promise.withResolvers();
const release = Promise.withResolvers();
const calls = [];
let held = false;
const recovery = {
  drive: {
    changeSetId: plan.changeSetId,
    planDigest: plan.planDigest,
    recoveryRootId: "recovery-root",
    retirementRootId: "retired-root",
    items: [],
    verified: true,
  },
  bytes: {
    changeSetId: plan.changeSetId,
    planDigest: plan.planDigest,
    path: "/synthetic/snapshot",
    items: [],
    localArtifacts: [],
    protection: "read-only-and-user-immutable",
    verified: true,
  },
};
const drive = {
  inventory: async () => {
    calls.push("inventory");
    return plan.inventory;
  },
  createFolder: async ({ operationId, parentId, name }) => {
    calls.push(operationId);
    if (operationId === "create-admin" && !held) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return {
      itemId: operationId,
      parentId,
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
  },
  createFile: async ({ operationId, parentId, name, mimeType }) => {
    calls.push(operationId);
    return { itemId: operationId, parentId, name, mimeType };
  },
  relocateItem: async ({ operationId, sourceId, parentId, name }) => {
    calls.push(operationId);
    return { itemId: sourceId, parentId, name, mimeType: "application/pdf" };
  },
  verifyContinuation: async () => {
    calls.push("continuation");
    return { blockers: [], recovered: [] };
  },
  verifyPostcondition: async () => {
    calls.push("postcondition");
    return [];
  },
};
const input = {
  plan,
  mode: "apply",
  resume: false,
  journal,
  drive,
  recovery: {
    recover: async () => {
      calls.push("recover");
      return recovery;
    },
    verify: async () => calls.push("verify-recovery"),
  },
};
const owner = executeRepairPlan(input);
void owner.catch(entered.reject);
const watchdog = setTimeout(() => {
  release.resolve();
  entered.reject(new Error("repair provider barrier not reached"));
}, 30000);
const result = { outcome: "running", calls };
const journalPath = join(
  destination,
  "journals",
  "repairs",
  `${plan.changeSetId}.jsonl`,
);
try {
  await entered.promise;
  const before = await readFile(journalPath);
  await writeFile(join(destination, "before.jsonl"), before);
  const count = calls.length;
  result.loser = await executeRepairPlan({ ...input, resume: true });
  result.loserCalls = calls.slice(count);
  await writeFile(
    join(destination, "after-loser.jsonl"),
    await readFile(journalPath),
  );
  release.resolve();
  const settled = await Promise.allSettled([owner]);
  result.owner = settled.map((item) =>
    item.status === "fulfilled"
      ? { status: item.status, value: item.value }
      : { status: item.status, error: String(item.reason) },
  );
  assert.deepEqual(
    result.loserCalls,
    [],
    "competing repair performed provider effects",
  );
  assert.equal(result.loser.outcome, "blocked");
  assert.match(result.loser.evidence.join(" "), /another invocation owns/iu);
  assert.deepEqual(
    await readFile(join(destination, "after-loser.jsonl")),
    before,
  );
  assert.equal(settled[0].status, "fulfilled");
  assert.equal(settled[0].value.outcome, "completed");
  assert.equal(calls.filter((call) => call === "create-admin").length, 1);
  result.outcome = "passed";
} catch (error) {
  result.outcome = "failed";
  result.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  release.resolve();
  await Promise.allSettled([owner]);
  await writeFile(
    join(destination, "results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
