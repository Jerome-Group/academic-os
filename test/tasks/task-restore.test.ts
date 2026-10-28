import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import { createFileTaskLifecycleStore } from "../../src/tasks/file-task-lifecycle-store.js";
import { createFileTaskRecoveryStore } from "../../src/tasks/file-task-recovery-store.js";
import { createFileTaskRestoreJournal } from "../../src/tasks/file-task-restore-journal.js";
import { unsupportedNativeTaskTimingObservation } from "../../src/tasks/native-task-timing.js";
import { taskExecutionSnapshot } from "../../src/tasks/task-execution-plan.js";
import type { TaskLifecycleEntry } from "../../src/tasks/task-lifecycle.js";
import { createFileTaskOperationJournal } from "../../src/tasks/task-operation-journal-file.js";
import { executeTaskRestore } from "../../src/tasks/task-restore.js";
import {
  parseTaskRestorePlan,
  taskRestorePlanDigest,
} from "../../src/tasks/task-restore-plan.js";
import type {
  TaskRestoreInput,
  TaskRestoreJournal,
  TaskRestorePlan,
} from "../../src/tasks/task-restore-types.js";
import type { TaskRecoveryCapture } from "../../src/tasks/task-recovery-types.js";
import type {
  LiveTask,
  TaskOperationWriter,
  TaskRegister,
} from "../../src/tasks/types.js";

async function fixture(
  t: TestContext,
  options: {
    task?: Partial<LiveTask>;
    entry?: Partial<TaskLifecycleEntry>;
    untracked?: boolean;
    snapshot?: Partial<TaskRecoveryCapture>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-task-restore-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state");
  const excluded = join(root, "excluded");
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(excluded, { mode: 0o700 });
  const target = {
    identity: {
      kind: "module" as const,
      key: "fixture/module",
      title: "Fixture",
    },
    registerStore: {
      read: async () => structuredClone(register),
      write: async (value: TaskRegister) => {
        if (failLocal) throw new Error("synthetic local failure");
        register = structuredClone(value);
      },
    },
  };
  const historical: LiveTask = {
    id: "old-id",
    title: "Review source",
    status: "needsAction",
    ...options.task,
  };
  let register: TaskRegister = {
    listId: "fixture-list",
    tasks: [
      {
        taskId: "old-id",
        title: "Review source",
        status: historical.status === "completed" ? "completed" : "open",
        provenance: {
          source: "fixture-source",
          milestone: "fixture-milestone",
        },
      },
    ],
  };
  const lifecycle = createFileTaskLifecycleStore({
    stateRoot,
    excludedRoots: [excluded],
  });
  const occurrence = options.untracked
    ? 'provider:["fixture-list","old-id"]'
    : "source/occurrence";
  if (!options.untracked)
    await lifecycle.withMutation((session) =>
      session.record({
        target: { kind: target.identity.kind, key: target.identity.key },
        occurrenceId: occurrence,
        source: { kind: "source", id: "fixture-source" },
        disposition: "active",
        recordedAt: "2026-10-27T00:00:00Z",
        evidenceRef: "fixture-evidence",
        providers: [
          {
            canonical: { listId: "fixture-list", taskId: "old-id" },
            aliases: [],
          },
        ],
        ...options.entry,
      }),
    );
  const recovery = createFileTaskRecoveryStore({
    stateRoot,
    excludedRoots: [excluded],
  });
  const snapshot = await recovery.capture({
    target: target.identity,
    listId: "fixture-list",
    register,
    live: [historical],
    reason: "refresh",
    lifecycle: await lifecycle.read(),
    ...(options.untracked
      ? {}
      : {
          sources: [
            {
              taskId: "old-id",
              sourceOccurrenceId: occurrence,
              operationId: "historical-create",
              planDigest: "a".repeat(64),
            },
          ],
        }),
    ...options.snapshot,
  });
  const live: LiveTask[] = [];
  const otherLists = new Map<string, LiveTask[]>();
  let creates = 0,
    reads = 0,
    failRead = false,
    failLocal = false,
    loseResponse = false;
  let returnedId: string | undefined;
  const writer: TaskOperationWriter = {
    createTask: async ({ task }) => {
      creates += 1;
      const id = returnedId ?? `new-${creates}`;
      live.push({ id, ...task });
      if (loseResponse) throw new Error("synthetic response loss");
      return { id };
    },
    readTask: async ({ taskId }) => {
      reads += 1;
      if (failRead) throw new Error("synthetic readback failure");
      return structuredClone(live.find((task) => task.id === taskId));
    },
    patchTask: async () => {
      assert.fail("Restore must never patch a provider Task.");
    },
    deleteTask: async () => {
      assert.fail("Restore must never delete a provider Task.");
    },
  };
  const reader = {
    listTasks: async ({ listId }: { listId: string }) =>
      structuredClone(
        listId === "fixture-list" ? live : (otherLists.get(listId) ?? []),
      ),
  };
  const journal = createFileTaskRestoreJournal({
    stateRoot,
    excludedRoots: [excluded],
  });
  const plan: TaskRestorePlan = {
    schemaVersion: "task-restore/1",
    operationId: "restore-operation",
    target: target.identity,
    listId: "fixture-list",
    snapshotId: snapshot.snapshotId,
    originalTaskId: "old-id",
    sourceOccurrenceId: occurrence,
    expectedSnapshot: taskExecutionSnapshot(live),
    expectedLifecycleRevision: (await lifecycle.read()).revision,
    policyVersion: "fixture-policy",
    ownerApprovalRef: "owner-explicit-recreation-review",
    scheduling: { mode: "api-fields-only", acknowledgeTimingLoss: true },
  };
  return {
    root,
    stateRoot,
    target,
    writer,
    reader,
    journal,
    recovery,
    lifecycle,
    live,
    otherLists,
    plan,
    snapshot,
    run: (extra: Partial<TaskRestoreInput> = {}) =>
      lifecycle.withMutation((session) =>
        executeTaskRestore({
          apply: true,
          plan,
          target,
          writer,
          reader,
          journal,
          recovery,
          lifecycle: session,
          ...extra,
        }),
      ),
    counts: () => ({ creates, reads }),
    register: () => register,
    setRegister: (value: TaskRegister) => {
      register = value;
    },
    failRead: (value: boolean) => {
      failRead = value;
    },
    failLocal: (value: boolean) => {
      failLocal = value;
    },
    loseResponse: () => {
      loseResponse = true;
    },
    returnId: (id: string) => {
      returnedId = id;
    },
  };
}

it("previews by default with fresh guards and no durable intent or provider mutation", async (t) => {
  const f = await fixture(t);
  const before = await f.recovery.list(f.target.identity);
  const preview = await f.run({ apply: false });
  assert.equal(preview.outcome, "preview");
  assert.deepEqual(f.counts(), { creates: 0, reads: 0 });
  assert.deepEqual(await f.recovery.list(f.target.identity), before);
  assert.equal(
    (await readdir(join(f.stateRoot, "task-operations"))).some((name) =>
      name.endsWith(".json"),
    ),
    false,
  );
  assert.equal(
    (await f.lifecycle.read()).revision,
    f.plan.expectedLifecycleRevision,
  );
});

it("recreates a deleted exact Task with a new ID, provenance, and retained lifecycle identity", async (t) => {
  const f = await fixture(t);
  f.live.push({ id: "old-id", deleted: true });
  f.plan.expectedSnapshot = taskExecutionSnapshot(f.live);
  const result = await f.run();
  assert.equal(result.outcome, "applied");
  assert.equal(result.originalTaskId, "old-id");
  assert.equal(result.newTaskId, "new-1");
  assert.equal(result.registerFresh, true);
  assert.equal(result.nativeTimingRestored, false);
  assert.equal(result.identityHistoryRestored, false);
  assert.equal(
    f.register().tasks.find((row) => row.taskId === "old-id")?.status,
    "cancelled",
  );
  assert.deepEqual(
    f.register().tasks.find((row) => row.taskId === "new-1")?.provenance,
    { source: "fixture-source", milestone: "fixture-milestone" },
  );
  const entry = (await f.lifecycle.read()).entries[0];
  assert.equal(entry?.evidenceRef, "fixture-evidence");
  assert.deepEqual(
    entry?.providers.map((binding) => binding.canonical.taskId),
    ["old-id", "new-1"],
  );
  assert.equal(
    entry?.providers.flatMap((binding) => binding.aliases).length,
    0,
  );
  assert.ok(
    (await f.recovery.list(f.target.identity)).some(
      (item) => item.operation?.phase === "before-restore",
    ),
  );
  assert.equal(
    (await readdir(join(f.stateRoot, "task-recovery"))).some((name) =>
      name.startsWith(".retain-"),
    ),
    false,
  );
});

it("recreates completed Tasks as completed and retains terminal disposition evidence", async (t) => {
  const f = await fixture(t, {
    task: { status: "completed", completed: "2026-10-26T00:00:00Z" },
    entry: { disposition: "completed" },
  });
  assert.equal((await f.run()).outcome, "applied");
  assert.equal(f.live[0]?.status, "completed");
  assert.equal(
    f.register().tasks.find((row) => row.taskId === "new-1")?.status,
    "completed",
  );
  const entry = (await f.lifecycle.read()).entries[0];
  assert.equal(entry?.disposition, "completed");
  assert.equal(entry?.recordedAt, "2026-10-27T00:00:00Z");
  assert.equal(entry?.evidenceRef, "fixture-evidence");
});

it("uses the stable exact provider occurrence only when no source evidence exists", async (t) => {
  const f = await fixture(t, { untracked: true });
  assert.equal((await f.run()).outcome, "applied");
  assert.equal(
    (await f.lifecycle.read()).entries[0]?.occurrenceId,
    'provider:["fixture-list","old-id"]',
  );
});

it("applied retries verify live state without creating again or overriding manual edits", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).outcome, "applied");
  assert.equal((await f.run()).outcome, "applied");
  assert.equal(f.counts().creates, 1);
  assert.ok(f.counts().reads >= 2);
  const task = f.live.find((item) => item.id === "new-1");
  assert.ok(task);
  task.title = "Owner changed this";
  const retry = await f.run();
  assert.equal(retry.code, "readback-conflict");
  assert.equal(task.title, "Owner changed this");
  assert.equal(f.counts().creates, 1);
});

it("refuses stale complete provider snapshots, stale lifecycle revisions, and changed list bindings", async (t) => {
  for (const change of ["provider", "lifecycle", "register"] as const) {
    const f = await fixture(t);
    if (change === "provider")
      f.live.push({ id: "unrelated", title: "Owner addition" });
    if (change === "lifecycle") f.plan.expectedLifecycleRevision += 1;
    if (change === "register")
      f.setRegister({ listId: "other-list", tasks: [] });
    const result = await f.run();
    assert.equal(result.outcome, "conflict");
    assert.equal(
      result.code,
      change === "provider"
        ? "stale-snapshot"
        : change === "lifecycle"
          ? "stale-lifecycle"
          : "list-mismatch",
    );
    assert.equal(f.counts().creates, 0);
  }
});

it("preserves existing manual Tasks and conservatively refuses title collisions", async (t) => {
  for (const id of ["old-id", "manual-other-id"]) {
    const f = await fixture(t);
    f.live.push({
      id,
      title: id === "old-id" ? "Manually changed" : "  REVIEW SOURCE  ",
    });
    f.plan.expectedSnapshot = taskExecutionSnapshot(f.live);
    const result = await f.run();
    assert.equal(
      result.code,
      id === "old-id" ? "original-task-exists" : "possible-duplicate-title",
    );
    assert.equal(f.counts().creates, 0);
    assert.equal(f.live.length, 1);
  }
});

it("refuses live verified aliases and other provider bindings", async (t) => {
  for (const listId of ["fixture-list", "other-list"]) {
    const f = await fixture(t, {
      entry: {
        providers: [
          {
            canonical: { listId: "fixture-list", taskId: "old-id" },
            aliases: [
              {
                identity: { listId, taskId: "alias-id" },
                verifiedAt: "2026-10-27T00:00:00Z",
                evidenceRef: "exact-alias-proof",
              },
            ],
          },
        ],
      },
    });
    if (listId === "fixture-list")
      f.live.push({ id: "alias-id", title: "Aliased Task" });
    else f.otherLists.set(listId, [{ id: "alias-id", title: "Aliased Task" }]);
    f.plan.expectedSnapshot = taskExecutionSnapshot(f.live);
    assert.equal((await f.run()).code, "bound-provider-exists");
    assert.equal(f.counts().creates, 0);
  }
});

it("never overrides owner dismissal, reopens completed lifecycle, or invents a new occurrence", async (t) => {
  for (const disposition of ["owner-dismissed", "completed"] as const) {
    const f = await fixture(t, { entry: { disposition } });
    assert.equal(
      (await f.run()).code,
      disposition === "completed" ? "task-completed" : "owner-dismissed",
    );
    assert.equal(f.counts().creates, 0);
    f.plan.sourceOccurrenceId = "new-source-to-evade-suppression";
    assert.equal((await f.run()).code, "source-occurrence-mismatch");
    assert.equal(f.counts().creates, 0);
  }
});

it("retains backups but refuses due dates, descriptions, hierarchy, and native timing", async (t) => {
  for (const field of [
    "due",
    "notes",
    "parent",
    "hierarchy",
    "native",
  ] as const) {
    const task =
      field === "due"
        ? { due: "2026-10-28T00:00:00Z" }
        : field === "notes"
          ? { notes: "Do not drop this description" }
          : field === "parent"
            ? { parent: "parent-id" }
            : {};
    const source: LiveTask = { id: "old-id", title: "Review source", ...task };
    const f = await fixture(t, {
      task,
      ...(field === "hierarchy"
        ? { snapshot: { live: [source, { id: "child-id", parent: "old-id" }] } }
        : {}),
      ...(field === "native"
        ? {
            snapshot: {
              nativeTiming: {
                schemaVersion: 1,
                status: "observed",
                observedAt: "2026-10-27T00:00:00Z",
                timeZone: "UTC",
                horizon: {
                  start: "2026-10-27T00:00:00Z",
                  end: "2026-10-28T00:00:00Z",
                },
                complete: {
                  tasks: true,
                  busy: true,
                  meals: true,
                  protected: true,
                },
                protectedIntervals: [],
                tasks: [
                  {
                    identity: {
                      canonical: { listId: "fixture-list", taskId: "old-id" },
                      aliases: [],
                    },
                    timing: {
                      start: "2026-10-27T10:00:00Z",
                      end: "2026-10-27T10:30:00Z",
                    },
                    ownership: { kind: "manual" },
                    evidence: {
                      surface: "native-task-editor",
                      verifiedAt: "2026-10-27T00:00:00Z",
                      reference: "fixture-native-proof",
                    },
                  },
                ],
              },
            },
          }
        : {}),
    });
    const result = await f.run();
    assert.equal(
      result.code,
      field === "due" || field === "native"
        ? "native-timing-unavailable"
        : "unsupported-fields",
    );
    assert.equal(f.counts().creates, 0);
    assert.ok(await f.recovery.read(f.snapshot.snapshotId));
  }
});

it("keeps unknown create outcomes uncertain and prevents retries under a new operation ID", async (t) => {
  const f = await fixture(t);
  f.loseResponse();
  assert.equal((await f.run()).outcome, "uncertain");
  assert.equal((await f.run()).code, "unknown-create-outcome");
  const another = {
    ...f.plan,
    operationId: "another-operation",
    expectedSnapshot: taskExecutionSnapshot(f.live),
  };
  assert.equal(
    (await f.run({ plan: another })).code,
    "restore-identity-reserved",
  );
  assert.equal(f.counts().creates, 1);
  assert.equal(
    (await readdir(join(f.stateRoot, "task-recovery"))).some((name) =>
      name.startsWith(".retain-"),
    ),
    true,
  );
});

it("resumes a durably known new ID after interrupted readback without resending", async (t) => {
  const f = await fixture(t);
  f.failRead(true);
  assert.equal((await f.run()).outcome, "uncertain");
  assert.equal(f.counts().creates, 1);
  f.failRead(false);
  const retried = await f.run();
  assert.equal(retried.outcome, "applied");
  assert.equal(retried.newTaskId, "new-1");
  assert.equal(f.counts().creates, 1);
});

it("reconciles interrupted local writes with the known provider ID", async (t) => {
  const f = await fixture(t);
  f.failLocal(true);
  assert.equal((await f.run()).code, "local-reconciliation-failed");
  f.failLocal(false);
  assert.equal((await f.run()).outcome, "applied");
  assert.equal(f.counts().creates, 1);
});

it("retains an unknown-ID journal when persisting the returned ID fails", async (t) => {
  const f = await fixture(t);
  const interrupted: TaskRestoreJournal = {
    withOwner: (scope, run) =>
      f.journal.withOwner(scope, (session) =>
        run({
          read: session.read,
          write: (record) => {
            if (record.phase === "sending" && record.taskId !== null)
              throw new Error("synthetic crash before ID publication");
            return session.write(record);
          },
        }),
      ),
  };
  const result = await f.run({ journal: interrupted });
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.newTaskId, "new-1");
  assert.equal((await f.run()).code, "unknown-create-outcome");
  assert.equal(f.counts().creates, 1);
});

it("refuses reused operation IDs and provider reuse of the original ID", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).outcome, "applied");
  assert.equal(
    (await f.run({ plan: { ...f.plan, policyVersion: "changed-policy" } }))
      .code,
    "operation-id-reused",
  );
  const reused = await fixture(t);
  reused.returnId("old-id");
  assert.equal((await reused.run()).code, "provider-id-reused");
  assert.equal(reused.register().tasks.length, 1);
});

it("shares list serialization with ordinary Task operations", async (t) => {
  const f = await fixture(t);
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ordinary = createFileTaskOperationJournal(f.stateRoot).withOwner(
    { operationId: "ordinary", listId: "fixture-list" },
    async () => {
      entered?.();
      await hold;
    },
  );
  await ready;
  try {
    assert.equal((await f.run()).code, "owner-busy");
    assert.equal(f.counts().creates, 0);
  } finally {
    release?.();
    await ordinary;
  }
});

it("requires explicit owner approval and scheduling acknowledgement in a strict schema", () => {
  const plan: TaskRestorePlan = {
    schemaVersion: "task-restore/1",
    operationId: "op",
    target: { kind: "module", key: "fixture", title: "Fixture" },
    listId: "list",
    snapshotId: "snapshot",
    originalTaskId: "original",
    sourceOccurrenceId: "source",
    expectedSnapshot: "a".repeat(64),
    expectedLifecycleRevision: 0,
    policyVersion: "policy",
    ownerApprovalRef: "explicit-owner-ref",
    scheduling: { mode: "api-fields-only", acknowledgeTimingLoss: true },
  };
  assert.deepEqual(parseTaskRestorePlan(plan), plan);
  assert.equal(taskRestorePlanDigest(plan), taskRestorePlanDigest({ ...plan }));
  for (const invalid of [
    { ...plan, ownerApprovalRef: "" },
    { ...plan, scheduling: undefined },
    {
      ...plan,
      scheduling: { mode: "api-fields-only", acknowledgeTimingLoss: false },
    },
    { ...plan, timing: {} },
    { ...plan, expectedLifecycleRevision: -1 },
  ])
    assert.throws(() => parseTaskRestorePlan(invalid));
  assert.equal(
    unsupportedNativeTaskTimingObservation("Runtime has no native timing")
      .status,
    "unsupported",
  );
});

it("previews interrupted and applied known IDs without reconciling local data or advancing receipts", async (t) => {
  const f = await fixture(t);
  f.failRead(true);
  assert.equal((await f.run()).outcome, "uncertain");
  f.failRead(false);
  const readJournal = () =>
    f.journal.withOwner(
      {
        operationId: f.plan.operationId,
        listId: f.plan.listId,
        target: f.plan.target,
        originalTaskId: f.plan.originalTaskId,
        sourceOccurrenceId: f.plan.sourceOccurrenceId,
      },
      (session) => session.read(),
    );
  const before = {
    register: structuredClone(f.register()),
    lifecycle: await f.lifecycle.read(),
    journal: await readJournal(),
  };
  assert.equal((await f.run({ apply: false })).outcome, "preview");
  assert.deepEqual(f.register(), before.register);
  assert.deepEqual(await f.lifecycle.read(), before.lifecycle);
  assert.deepEqual(await readJournal(), before.journal);
  assert.equal((await f.run()).outcome, "applied");
  const applied = {
    register: structuredClone(f.register()),
    lifecycle: await f.lifecycle.read(),
    journal: await readJournal(),
  };
  assert.equal((await f.run({ apply: false })).outcome, "preview");
  assert.deepEqual(f.register(), applied.register);
  assert.deepEqual(await f.lifecycle.read(), applied.lifecycle);
  assert.deepEqual(await readJournal(), applied.journal);
  assert.equal(f.counts().creates, 1);
});

it("refuses live native aliases even when no lifecycle alias was recorded", async (t) => {
  const f = await fixture(t, {
    snapshot: {
      nativeTiming: {
        schemaVersion: 1,
        status: "observed",
        observedAt: "2026-10-27T00:00:00Z",
        timeZone: "UTC",
        horizon: { start: "2026-10-27T00:00:00Z", end: "2026-10-28T00:00:00Z" },
        complete: { tasks: true, busy: true, meals: true, protected: true },
        protectedIntervals: [],
        tasks: [
          {
            identity: {
              canonical: { listId: "fixture-list", taskId: "old-id" },
              aliases: [
                {
                  identity: { listId: "fixture-list", taskId: "native-alias" },
                  verifiedAt: "2026-10-27T00:00:00Z",
                  evidenceRef: "native-alias-proof",
                },
              ],
            },
            timing: null,
            ownership: { kind: "manual" },
            evidence: {
              surface: "native-task-editor",
              verifiedAt: "2026-10-27T00:00:00Z",
              reference: "fixture-native-proof",
            },
          },
        ],
      },
    },
  });
  f.live.push({ id: "native-alias", title: "Manual alias title" });
  f.plan.expectedSnapshot = taskExecutionSnapshot(f.live);
  assert.equal((await f.run()).code, "bound-provider-exists");
  assert.equal(f.counts().creates, 0);
});

it("refuses journals whose private root overlaps an excluded destination", async (t) => {
  const f = await fixture(t);
  const excluded = join(f.stateRoot, "task-operations");
  await mkdir(excluded, { mode: 0o700 });
  const journal = createFileTaskRestoreJournal({
    stateRoot: f.stateRoot,
    excludedRoots: [excluded],
  });
  assert.equal((await f.run({ journal })).outcome, "failed");
  assert.deepEqual(await readdir(excluded), []);
  assert.equal(f.counts().creates, 0);
});

it("reconstructs missing cancelled history and retains any current original-row evidence", async (t) => {
  for (const existing of [false, true]) {
    const f = await fixture(t);
    const original = {
      taskId: "old-id",
      title: "Owner retained historical title",
      status: "open" as const,
      provenance: { source: "owner-local-evidence" },
    };
    f.setRegister({
      listId: "fixture-list",
      tasks: existing ? [original] : [],
    });
    assert.equal((await f.run()).outcome, "applied");
    const old = f.register().tasks.find((row) => row.taskId === "old-id");
    assert.equal(old?.status, "cancelled");
    assert.equal(old?.title, existing ? original.title : "Review source");
    assert.deepEqual(
      old?.provenance,
      existing
        ? original.provenance
        : { source: "fixture-source", milestone: "fixture-milestone" },
    );
    assert.equal(
      f.register().tasks.find((row) => row.taskId === "new-1")?.status,
      "open",
    );
    assert.equal(f.register().tasks.length, 2);
  }
});

it("shares source serialization with ordinary operations on another list", async (t) => {
  const f = await fixture(t);
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ordinary = createFileTaskOperationJournal(f.stateRoot).withOwner(
    {
      operationId: "ordinary-other-list",
      listId: "other-list",
      sourceOccurrence: {
        target: f.plan.target,
        id: f.plan.sourceOccurrenceId,
      },
    },
    async () => {
      entered?.();
      await hold;
    },
  );
  await ready;
  try {
    assert.equal((await f.run()).code, "owner-busy");
    assert.equal(f.counts().creates, 0);
  } finally {
    release?.();
    await ordinary;
  }
});
