import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";

import { createFileTaskRecoveryStore } from "../../src/tasks/file-task-recovery-store.js";
import { executeTaskPlan } from "../../src/tasks/task-execution.js";
import {
  parseTaskExecutionPlan,
  taskExecutionSnapshot,
} from "../../src/tasks/task-execution-plan.js";
import { createFileTaskOperationJournal } from "../../src/tasks/task-operation-journal-file.js";
import type {
  TaskExecutionPlan,
  TaskOperationJournal,
} from "../../src/tasks/task-execution-types.js";
import type {
  LiveTask,
  TaskRegister,
  TaskOperationWriter,
} from "../../src/tasks/types.js";

async function fixture(t: TestContext) {
  const stateRoot = await mkdtemp(
    join(tmpdir(), "academic-os-task-execution-"),
  );
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  let register: TaskRegister = { listId: "fixture-list", tasks: [] };
  const live: LiveTask[] = [];
  let creates = 0,
    patches = 0,
    deletes = 0;
  let rejectReadback = false,
    rejectLocalWrite = false,
    loseCreateResponse = false;
  const target = {
    identity: {
      kind: "module" as const,
      key: "fixture/module",
      title: "Fixture",
    },
    registerStore: {
      read: async () => structuredClone(register),
      write: async (value: TaskRegister) => {
        if (rejectLocalWrite) throw new Error("synthetic local conflict");
        register = structuredClone(value);
      },
    },
  };
  const writer: TaskOperationWriter = {
    createTask: async ({ task }) => {
      creates++;
      const id = `created-${creates}`;
      live.push({ id, ...task });
      if (loseCreateResponse) throw new Error("synthetic lost response");
      return { id };
    },
    patchTask: async ({ taskId, patch }) => {
      patches++;
      const task = live.find((item) => item.id === taskId);
      assert.ok(task);
      Object.assign(task, patch);
    },
    deleteTask: async ({ taskId }) => {
      deletes++;
      live.splice(
        live.findIndex((task) => task.id === taskId),
        1,
      );
    },
    readTask: async ({ taskId }) => {
      if (rejectReadback) throw new Error("synthetic readback failure");
      return structuredClone(live.find((task) => task.id === taskId));
    },
  };
  const reader = { listTasks: async () => structuredClone(live) };
  const journal = createFileTaskOperationJournal(stateRoot);
  const plan: TaskExecutionPlan = {
    schemaVersion: 1,
    operationId: "fixture-operation",
    target: target.identity,
    listId: "fixture-list",
    expectedSnapshot: taskExecutionSnapshot(live),
    operation: {
      name: "create",
      title: "Fixture task",
      provenance: { source: "fixture-source" },
    },
    sourceOccurrenceId: "fixture-source/occurrence-1",
    policyVersion: "fixture-policy-v1",
  };
  return {
    target,
    writer,
    reader,
    journal,
    plan,
    stateRoot,
    live,
    run: (extra: Partial<Parameters<typeof executeTaskPlan>[0]> = {}) =>
      executeTaskPlan({ target, writer, reader, journal, plan, ...extra }),
    counts: () => ({ creates, patches, deletes }),
    register: () => register,
    setRegister: (value: TaskRegister) => {
      register = value;
    },
    failReadback: (value: boolean) => {
      rejectReadback = value;
    },
    failLocalWrite: (value: boolean) => {
      rejectLocalWrite = value;
    },
    loseResponse: () => {
      loseCreateResponse = true;
    },
  };
}

it("applies once and replays the same operation without another provider mutation", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).outcome, "applied");
  assert.equal((await f.run()).outcome, "applied");
  assert.deepEqual(f.counts(), { creates: 1, patches: 0, deletes: 0 });
  assert.equal(f.register().tasks[0]?.provenance?.source, "fixture-source");
});

it("recovers known create identity and provenance after failed verification across a new journal instance", async (t) => {
  const f = await fixture(t);
  f.failReadback(true);
  const first = await f.run();
  assert.equal(first.outcome, "uncertain");
  assert.equal(first.taskId, "created-1");
  assert.deepEqual(f.register().tasks, []);
  f.failReadback(false);
  const recovered = await f.run({
    journal: createFileTaskOperationJournal(f.stateRoot),
  });
  assert.equal(recovered.outcome, "applied");
  assert.equal(f.counts().creates, 1);
  assert.equal(f.register().tasks[0]?.provenance?.source, "fixture-source");
});

it("never retries a create whose accepted response lost its identity", async (t) => {
  const f = await fixture(t);
  f.loseResponse();
  assert.equal((await f.run()).outcome, "uncertain");
  const retry = await f.run({
    journal: createFileTaskOperationJournal(f.stateRoot),
  });
  assert.equal(retry.outcome, "uncertain");
  assert.equal(retry.taskId, null);
  assert.equal(f.counts().creates, 1);
});

it("repairs local provenance after a verified remote create and local failure without another create", async (t) => {
  const f = await fixture(t);
  f.failLocalWrite(true);
  const first = await f.run();
  assert.equal(first.outcome, "uncertain");
  assert.equal(first.registerFresh, false);
  f.failLocalWrite(false);
  assert.equal((await f.run()).outcome, "applied");
  assert.equal(f.counts().creates, 1);
  assert.equal(f.register().tasks[0]?.provenance?.source, "fixture-source");
});

it("rejects reuse of an operation ID with different exact content", async (t) => {
  const f = await fixture(t);
  await f.run();
  const changed = {
    ...f.plan,
    operation: { name: "create" as const, title: "Different" },
  };
  assert.equal((await f.run({ plan: changed })).outcome, "conflict");
  assert.equal(f.counts().creates, 1);
});

it("refuses stale provider snapshots before any write", async (t) => {
  const f = await fixture(t);
  f.live.push({
    id: "manual-addition",
    title: "Manually placed",
    due: "2026-10-28T00:00:00Z",
  });
  assert.equal((await f.run()).outcome, "conflict");
  assert.equal(f.counts().creates, 0);
});

it("includes provider updated and etag changes in the expected snapshot", () => {
  const old = [
    { id: "same", title: "Same", updated: "2026-10-27T00:00:00Z", etag: "v1" },
  ];
  assert.ok(old[0]);
  assert.notEqual(
    taskExecutionSnapshot(old),
    taskExecutionSnapshot([{ ...old[0], etag: "v2" }]),
  );
  assert.notEqual(
    taskExecutionSnapshot(old),
    taskExecutionSnapshot([{ ...old[0], updated: "2026-10-28T00:00:00Z" }]),
  );
  assert.equal(
    taskExecutionSnapshot([{ id: "b" }, { id: "a" }]),
    taskExecutionSnapshot([{ id: "a" }, { id: "b" }]),
  );
  assert.throws(() => taskExecutionSnapshot([{ id: "a" }, { id: "a" }]));
});

it("refuses target/list mismatches and completed-task edits", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.run({ plan: { ...f.plan, listId: "another-list" } })).outcome,
    "conflict",
  );
  assert.equal(
    (
      await f.run({
        plan: {
          ...f.plan,
          target: { ...f.plan.target, key: "another-target" },
        },
      })
    ).outcome,
    "conflict",
  );
  f.live.push({ id: "done", title: "Done", status: "completed" });
  f.setRegister({
    listId: "fixture-list",
    tasks: [{ taskId: "done", title: "Done", status: "completed" }],
  });
  const edit: TaskExecutionPlan = {
    ...f.plan,
    operation: { name: "change", taskId: "done", title: "Overwritten" },
    expectedSnapshot: taskExecutionSnapshot(f.live),
  };
  assert.equal((await f.run({ plan: edit })).outcome, "conflict");
  assert.deepEqual(f.counts(), { creates: 0, patches: 0, deletes: 0 });
});

it("refuses lifecycle conflicts without silently changing the plan", async (t) => {
  const f = await fixture(t);
  const result = await f.run({
    checks: { beforeWrite: async () => "owner-dismissed" },
  });
  assert.equal(result.outcome, "conflict");
  assert.equal(result.code, "owner-dismissed");
  assert.equal(f.counts().creates, 0);
});

it("holds one exclusive list owner across preflight, provider mutation, and recording", async (t) => {
  const f = await fixture(t);
  let entered!: () => void, release!: () => void;
  const entering = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = f.run({
    writer: {
      ...f.writer,
      createTask: async (input) => {
        entered();
        await blocked;
        return f.writer.createTask(input);
      },
    },
  });
  await entering;
  const second = await f.run({
    plan: { ...f.plan, operationId: "other-operation" },
    journal: createFileTaskOperationJournal(f.stateRoot),
  });
  assert.equal(second.outcome, "conflict");
  assert.equal(second.code, "owner-busy");
  release();
  assert.equal((await first).outcome, "applied");
  assert.equal(f.counts().creates, 1);
});

it("does not send when persisting the uncertain-before-send marker fails", async (t) => {
  const f = await fixture(t);
  const failing: TaskOperationJournal = {
    withOwner: (scope, run) =>
      f.journal.withOwner(scope, async (session) =>
        run({
          read: session.read,
          write: async (record) => {
            if (record.phase === "uncertain")
              throw new Error("synthetic journal failure");
            await session.write(record);
          },
        }),
      ),
  };
  assert.equal((await f.run({ journal: failing })).outcome, "failed");
  assert.equal(f.counts().creates, 0);
});

it("fails closed on malformed plans, description writes, missing create occurrence IDs, and unknown fields", async (t) => {
  const f = await fixture(t);
  for (const invalid of [
    { ...f.plan, ignored: true },
    { ...f.plan, operation: { ...f.plan.operation, notes: "" } },
    { ...f.plan, operation: { ...f.plan.operation, description: "No" } },
    { ...f.plan, sourceOccurrenceId: undefined },
    { ...f.plan, schemaVersion: 2 },
    { ...f.plan, expectedSnapshot: "not-a-digest" },
    { ...f.plan, operation: { name: "create", title: "" } },
  ])
    assert.throws(() => parseTaskExecutionPlan(invalid));
  assert.deepEqual(parseTaskExecutionPlan(f.plan), f.plan);
});

it("refuses a second operation ID for an existing or uncertain source occurrence", async (t) => {
  for (const uncertain of [false, true]) {
    const f = await fixture(t);
    if (uncertain) f.loseResponse();
    await f.run();
    const again = await f.run({
      plan: {
        ...f.plan,
        operationId: "new-operation",
        expectedSnapshot: taskExecutionSnapshot(f.live),
      },
    });
    assert.equal(again.outcome, "conflict");
    assert.equal(again.code, "source-occurrence-reserved");
    assert.equal(f.counts().creates, 1);
  }
});

it("does not claim freshness when the written register fails readback", async (t) => {
  const f = await fixture(t);
  const target = {
    ...f.target,
    registerStore: {
      read: async () => ({ listId: "fixture-list", tasks: [] }),
      write: async () => {},
    },
  };
  const observed = await f.run({ target });
  assert.equal(observed.outcome, "uncertain");
  assert.equal(observed.registerFresh, false);
  assert.equal(observed.code, "local-recording-unverified");
  assert.equal(f.counts().creates, 1);
});

it("retains known remote identity when owner cleanup fails after execution", async (t) => {
  const f = await fixture(t);
  const journal: TaskOperationJournal = {
    withOwner: async (scope, run) => {
      await f.journal.withOwner(scope, run);
      throw new Error("synthetic owner-release failure");
    },
  };
  const observed = await f.run({ journal });
  assert.equal(observed.outcome, "uncertain");
  assert.equal(observed.code, "owner-release-failed");
  assert.equal(observed.taskId, "created-1");
  assert.equal(f.counts().creates, 1);
  assert.equal((await f.run()).outcome, "applied");
  assert.equal(f.counts().creates, 1);
});

for (const name of ["create", "change", "complete", "cancel"] as const) {
  it(`does not finalize ${name} when the final list contradicts verified provider state`, async (t) => {
    const f = await fixture(t);
    if (name !== "create") {
      f.live.push({ id: "existing", title: "Existing", status: "needsAction" });
      f.setRegister({
        listId: "fixture-list",
        tasks: [{ taskId: "existing", title: "Existing", status: "open" }],
      });
    }
    const original = structuredClone(f.live);
    const operation =
      name === "create"
        ? f.plan.operation
        : name === "change"
          ? { name, taskId: "existing", title: "Planned title" }
          : { name, taskId: "existing" };
    const plan: TaskExecutionPlan = {
      ...f.plan,
      operation,
      expectedSnapshot: taskExecutionSnapshot(f.live),
    };
    let reads = 0,
      finalized = 0;
    const reader = {
      listTasks: async () => {
        if (++reads === 1) return structuredClone(f.live);
        if (name === "create") return [];
        if (name === "cancel") return original;
        return f.live.map((task) =>
          name === "complete"
            ? { ...task, status: "needsAction" as const }
            : { ...task, title: "Manual edit" },
        );
      },
    };
    const checks = {
      afterApplied: async () => {
        finalized++;
      },
    };
    const first = await f.run({ plan, reader, checks });
    assert.equal(first.outcome, "uncertain");
    assert.equal(first.code, "final-snapshot-conflict");
    assert.equal(finalized, 0);
    const count = f.counts();
    assert.equal((await f.run({ plan, reader, checks })).outcome, "uncertain");
    assert.deepEqual(f.counts(), count);
    assert.equal(finalized, 0);
  });
}

it("recovers a journaled create after process death without stealing a stopped owner or resending", {
  timeout: 20_000,
}, async (t) => {
  const f = await fixture(t);
  const remoteState = join(f.stateRoot, "synthetic-provider.json");
  const executorUrl = new URL(
    "../../src/tasks/task-execution.js",
    import.meta.url,
  ).href;
  const journalUrl = new URL(
    "../../src/tasks/task-operation-journal-file.js",
    import.meta.url,
  ).href;
  const childSource = `
    import { writeFile } from "node:fs/promises";
    import { executeTaskPlan } from ${JSON.stringify(executorUrl)};
    import { createFileTaskOperationJournal } from ${JSON.stringify(journalUrl)};
    process.on("message", () => {});
    const plan = ${JSON.stringify(f.plan)};
    let register = { listId: plan.listId, tasks: [] };
    const target = { identity: plan.target, registerStore: {
      read: async () => structuredClone(register),
      write: async (value) => { register = structuredClone(value); }
    }};
    await executeTaskPlan({
      plan, target, journal: createFileTaskOperationJournal(${JSON.stringify(f.stateRoot)}),
      reader: { listTasks: async () => [] },
      writer: {
        createTask: async ({ task }) => {
          await writeFile(${JSON.stringify(remoteState)}, JSON.stringify({ creates: 1, task: { id: "created-1", ...task } }));
          return { id: "created-1" };
        },
        readTask: async () => { process.send("verification"); return new Promise(() => {}); },
        patchTask: async () => { throw new Error("unexpected patch"); },
        deleteTask: async () => { throw new Error("unexpected delete"); },
      },
    });
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childSource],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const exited = once(child, "exit");
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  const [message] = await once(child, "message", {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(message, "verification");
  child.kill("SIGSTOP");
  const busy = await f.run();
  assert.equal(busy.outcome, "conflict");
  assert.equal(busy.code, "owner-busy");
  child.kill("SIGKILL");
  const [, signal] = await exited;
  assert.equal(signal, "SIGKILL");
  const remote = JSON.parse(await readFile(remoteState, "utf8")) as {
    creates: number;
    task: LiveTask;
  };
  f.live.push(remote.task);
  const recovered = await f.run({
    writer: {
      ...f.writer,
      createTask: async () => assert.fail("Recovery must not resend creation."),
    },
  });
  assert.equal(recovered.outcome, "applied");
  assert.equal(recovered.taskId, "created-1");
  assert.equal(f.register().tasks[0]?.provenance?.source, "fixture-source");
  assert.equal(remote.creates, 1);
  assert.equal(f.counts().creates, 0);
});

it("permits a corrected new operation for a definitively rejected source without replaying the rejected request", async (t) => {
  const f = await fixture(t);
  let rejectedRequests = 0;
  const rejected = await f.run({
    writer: {
      ...f.writer,
      createTask: async () => {
        rejectedRequests++;
        throw { response: { status: 403 } };
      },
    },
  });
  assert.equal(rejected.outcome, "failed");
  assert.equal(rejected.code, "provider-rejected");
  const corrected: TaskExecutionPlan = {
    ...f.plan,
    operationId: "corrected-operation",
    operation: { name: "create", title: "Corrected" },
  };
  assert.equal((await f.run({ plan: corrected })).outcome, "applied");
  assert.equal(rejectedRequests, 1);
  assert.equal(f.counts().creates, 1);
  assert.equal((await f.run()).outcome, "conflict");
  assert.equal(f.counts().creates, 1);
});

it("permits a new operation when prior source intent was prepared but could not persist before-send uncertainty", async (t) => {
  const f = await fixture(t);
  const journal: TaskOperationJournal = {
    withOwner: (scope, run) =>
      f.journal.withOwner(scope, async (session) =>
        run({
          read: session.read,
          write: async (record) => {
            if (record.phase === "uncertain")
              throw new Error("synthetic marker refusal");
            await session.write(record);
          },
        }),
      ),
  };
  assert.equal((await f.run({ journal })).outcome, "failed");
  assert.equal(f.counts().creates, 0);
  assert.equal(
    (await f.run({ plan: { ...f.plan, operationId: "replacement-operation" } }))
      .outcome,
    "applied",
  );
  assert.equal(f.counts().creates, 1);
  assert.equal((await f.run()).outcome, "conflict");
});

it("reobserves provider state after a recovery capture before sending an ordinary plan", async (t) => {
  const f = await fixture(t);
  const recovery = createFileTaskRecoveryStore({
    stateRoot: f.stateRoot,
    excludedRoots: [process.cwd()],
  });
  const report = await f.run({
    target: {
      ...f.target,
      recoveryStore: {
        ...recovery,
        capture: async (input) => {
          const snapshot = await recovery.capture(input);
          f.live.push({
            id: "manual-intervening",
            title: "Manual change",
            status: "needsAction",
          });
          return snapshot;
        },
      },
    },
  });
  assert.equal(report.code, "stale-snapshot");
  assert.deepEqual(f.counts(), { creates: 0, patches: 0, deletes: 0 });
  assert.equal((await recovery.list(f.target.identity)).length, 1);
});
