import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createFileRepairJournalStore,
  createRepairPlan,
  executeRepairPlan,
  type RepairExecutionDrive,
  type RepairMutationJournal,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";
import {
  journalFixture,
  journalProcess,
  optionalBytes,
} from "../support/journal-process.js";

const preload = fileURLToPath(
  new URL(
    "../../../test/support/journal-ownership-preload.mjs",
    import.meta.url,
  ),
);
const driver = fileURLToPath(
  new URL("../support/journal-owner-child.js", import.meta.url),
);
const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));

test("repair apply owns its whole provider operation and completed repeat", async (t) => {
  const root = await journalFixture(t, "repair-provider");
  const plan = createRepairPlan(repairPlanDraft());
  const journal = createFileRepairJournalStore(root);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const recovery = {
    drive: {
      changeSetId: plan.changeSetId,
      planDigest: plan.planDigest,
      recoveryRootId: "recovery-root",
      retirementRootId: "retired-root",
      items: [],
      verified: true as const,
    },
    bytes: {
      changeSetId: plan.changeSetId,
      planDigest: plan.planDigest,
      path: "/synthetic/snapshot",
      items: [],
      localArtifacts: [],
      protection: "read-only-and-user-immutable" as const,
      verified: true as const,
    },
  };
  const drive: RepairExecutionDrive = {
    inventory: async () => {
      calls.push("inventory");
      return plan.inventory;
    },
    createFolder: async ({ operationId, parentId, name }) => {
      calls.push(operationId);
      if (operationId === "create-admin") {
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
    mode: "apply" as const,
    resume: false,
    journal,
    drive,
    recovery: {
      recover: async () => {
        calls.push("recover");
        return recovery;
      },
      verify: async () => {
        calls.push("verify-recovery");
      },
    },
  };
  const owner = executeRepairPlan(input);
  await entered.promise;
  const path = join(root, "journals", "repairs", `${plan.changeSetId}.jsonl`);
  const before = await readFile(path);
  const callsBefore = [...calls];
  try {
    const loser = await executeRepairPlan({ ...input, resume: true });
    assert.equal(loser.outcome, "blocked");
    assert.match(loser.evidence.join(" "), /another invocation owns/iu);
    assert.deepEqual(calls, callsBefore);
    assert.deepEqual(await readFile(path), before);
  } finally {
    release.resolve();
  }
  assert.equal((await owner).outcome, "completed");
  assert.equal(calls.filter((call) => call === "create-admin").length, 1);
  assert.equal(
    (await executeRepairPlan({ ...input, resume: true })).outcome,
    "completed",
  );
  const events = await journal.inspect(plan.changeSetId);
  assert.deepEqual(
    events.map(({ sequence }) => sequence),
    events.map((_, index) => index),
  );
  await writeFile(join(root, "provider-calls.json"), JSON.stringify(calls));
});

test("repair sessions bind the change set and expire at callback settlement", async (t) => {
  const root = await journalFixture(t, "repair-session");
  const store = createFileRepairJournalStore(root);
  const plan = createRepairPlan(repairPlanDraft());
  let session: RepairMutationJournal | undefined;
  await store.mutate(plan.changeSetId, async (journal) => {
    session = journal;
  });
  assert.ok(session);
  await assert.rejects(session.read(), /expired/u);
  const started = {
    schemaVersion: 1 as const,
    sequence: 0,
    recordedAt: "2026-10-24T00:00:00Z",
    changeSetId: plan.changeSetId,
    planDigest: plan.planDigest,
    type: "started" as const,
    plan,
  };
  await assert.rejects(session.append(started), /expired/u);
  await assert.rejects(
    store.mutate(
      plan.changeSetId,
      async (journal) =>
        await journal.append({
          ...started,
          changeSetId: "22222222-2222-4222-8222-222222222222",
        }),
    ),
    /another change set/u,
  );
  assert.deepEqual(await store.inspect(plan.changeSetId), []);
});

test("uppercase historical repair IDs remain inspectable and refuse mutation before ownership allocation", async (t) => {
  const root = await journalFixture(t, "repair-case-alias");
  const store = createFileRepairJournalStore(root);
  const lower = "abcdef11-1111-4111-8111-111111111111";
  const upper = lower.toUpperCase();
  const directory = join(root, "journals", "repairs");
  await mkdir(directory, { recursive: true });
  const plan = createRepairPlan(repairPlanDraft());
  const event = {
    schemaVersion: 1,
    sequence: 0,
    recordedAt: "2026-10-24T00:00:00Z",
    changeSetId: upper,
    planDigest: plan.planDigest,
    type: "started",
    plan,
  };
  const path = join(directory, `${upper}.jsonl`);
  await writeFile(path, `${JSON.stringify(event)}\n`);
  const before = await readFile(path);
  assert.deepEqual(await store.inspect(upper), [event]);
  await assert.rejects(
    store.mutate(upper, async () => assert.fail("uppercase mutation")),
    /lowercase.*reconcile/u,
  );
  assert.deepEqual(await readFile(path), before);
  assert.equal(
    (await optionalBytes(join(root, "journal-ownership"))).length,
    0,
  );
});

test("a pending append stays owned after its callback returns and its session expires", async (t) => {
  const root = await journalFixture(t, "repair-drain");
  const changeSetId = "11111111-1111-4111-8111-111111111111";
  const path = join(root, "journals", "repairs", `${changeSetId}.jsonl`);
  const owner = journalProcess(
    t,
    root,
    "owner",
    ["--import", preload, driver, root, path, "drain"],
    { AOS_JOURNAL_POINT: "append" },
  );
  await owner.wait("callback-settled");
  await owner.wait("barrier");
  await owner.wait("expired-session");
  const store = createFileRepairJournalStore(root);
  assert.equal(
    (
      await store.mutate(changeSetId, async () =>
        assert.fail("drain contender"),
      )
    ).kind,
    "refused",
  );
  owner.child.send("release");
  const result = await owner.done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).kind, "owned");
  assert.equal((await store.inspect(changeSetId)).length, 1);
  assert.equal(
    (await store.mutate(changeSetId, async () => "next")).kind,
    "owned",
  );
  const failedRoot = join(root, "failed-drain");
  await mkdir(failedRoot);
  const failed = journalProcess(
    t,
    root,
    "failed-append",
    ["--import", preload, driver, failedRoot, path, "drain"],
    { AOS_JOURNAL_POINT: "append", AOS_JOURNAL_FAIL_APPEND: "1" },
  );
  await failed.wait("barrier");
  assert.equal(
    (
      await createFileRepairJournalStore(failedRoot).mutate(
        changeSetId,
        async () => assert.fail("failed drain contender"),
      )
    ).kind,
    "refused",
  );
  failed.child.send("release");
  const rejected = await failed.done;
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /synthetic pending append failure/u);
  assert.equal(
    (
      await createFileRepairJournalStore(failedRoot).mutate(
        changeSetId,
        async () => "retry",
      )
    ).kind,
    "owned",
  );
});

test("repair CLI resume refuses before continuation reads, recovery or provider requests", async (t) => {
  const root = await journalFixture(t, "repair-cli");
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const snapshotRoot = join(root, "Snapshot");
  const moduleRoot = join(driveMount, "Modules", "Y9S9", "ZZ9999");
  await mkdir(moduleRoot, { recursive: true });
  await mkdir(stateRoot);
  await mkdir(snapshotRoot);
  const config = join(root, "config.json");
  const planPath = join(root, "plan.json");
  const plan = createRepairPlan(repairPlanDraft());
  await writeFile(planPath, JSON.stringify(plan));
  await writeFile(
    config,
    JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y9S9",
      semesters: {
        Y9S9: { root: "Modules/Y9S9", status: "active", modules: ["ZZ9999"] },
      },
      driveApi: { moduleFolderIds: { Y9S9: { ZZ9999: "module-id" } } },
      repair: { driveRecoveryRootId: "recovery-root", snapshotRoot },
    }),
  );
  const fakeDrive = fileURLToPath(
    new URL("../support/fake-repair-drive-preload.js", import.meta.url),
  );
  const args = [
    "--import",
    fakeDrive,
    "--import",
    preload,
    cli,
    "repair",
    "--config",
    config,
    "--plan",
    planPath,
    "--apply",
    "--resume",
    "--json",
  ];
  const owner = journalProcess(t, root, "owner", args, {
    AOS_JOURNAL_POINT: "read",
    AOS_REPAIR_REQUEST_TRACE: join(root, "owner-provider.trace"),
  });
  await owner.wait("barrier");
  const path = join(
    stateRoot,
    "journals",
    "repairs",
    `${plan.changeSetId}.jsonl`,
  );
  const before = await optionalBytes(path);
  const loser = await journalProcess(t, root, "loser", args, {
    AOS_JOURNAL_TRACE: join(root, "loser-journal.trace"),
    AOS_REPAIR_REQUEST_TRACE: join(root, "loser-provider.trace"),
  }).done;
  assert.equal(JSON.parse(loser.stdout).outcome, "blocked", loser.stderr);
  assert.match(
    JSON.parse(loser.stdout).evidence.join(" "),
    /another invocation owns/iu,
  );
  assert.deepEqual(await optionalBytes(path), before);
  assert.equal(
    (await optionalBytes(join(root, "loser-journal.trace"))).length,
    0,
  );
  assert.equal(
    (await optionalBytes(join(root, "loser-provider.trace"))).length,
    0,
  );
  owner.child.send("release");
  const completed = await owner.done;
  assert.equal(
    JSON.parse(completed.stdout).outcome,
    "blocked",
    completed.stderr,
  );
  const events = await createFileRepairJournalStore(stateRoot).inspect(
    plan.changeSetId,
  );
  assert.deepEqual(
    events.map(({ sequence }) => sequence),
    events.map((_, index) => index),
  );
});
