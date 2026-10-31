import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import { sha256 } from "../../src/checksum.js";
import {
  createFileTaskOperationJournal,
  findTaskCreationSource,
  TaskOperationOwnershipError,
} from "../../src/tasks/task-operation-journal-file.js";
import {
  taskExecutionPlanDigest,
  taskExecutionSnapshot,
} from "../../src/tasks/task-execution-plan.js";
import type {
  TaskOperationJournalRecord,
  TaskOperationJournalSession,
} from "../../src/tasks/task-execution-types.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-task-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = {
    schemaVersion: 1 as const,
    operationId: "operation",
    listId: "list",
    target: {
      kind: "module" as const,
      key: "fixture/module",
      title: "Fixture",
    },
    expectedSnapshot: taskExecutionSnapshot([]),
    operation: { name: "create" as const, title: "Fixture" },
    sourceOccurrenceId: "source/1",
    policyVersion: "v1",
  };
  const record: TaskOperationJournalRecord = {
    schemaVersion: 1,
    plan,
    planDigest: taskExecutionPlanDigest(plan),
    phase: "prepared",
    taskId: null,
  };
  return {
    root,
    record,
    scope: { operationId: "operation", listId: "list" },
    journal: createFileTaskOperationJournal(root),
  };
}

it("persists uncertainty and a returned identity before independent recovery", async (t) => {
  const f = await fixture(t);
  await f.journal.withOwner(f.scope, async (session) => {
    await session.write(f.record);
    await session.write({ ...f.record, phase: "uncertain" });
    await session.write({ ...f.record, phase: "uncertain", taskId: "known" });
  });
  await assert.rejects(
    createFileTaskOperationJournal(f.root).withOwner(
      f.scope,
      async (session) => {
        assert.deepEqual(await session.read(), {
          ...f.record,
          phase: "uncertain",
          taskId: "known",
        });
        await assert.rejects(
          session.write(f.record),
          /cannot rewind|identity changed/u,
        );
      },
    ),
    /cannot rewind|identity changed/u,
  );
  assert.equal(
    (await readdir(join(f.root, "task-operations"))).some((name) =>
      name.endsWith(".lock"),
    ),
    false,
  );
});

it("retains legacy ownership evidence instead of automatically deleting it", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "task-operations");
  await mkdir(directory, { mode: 0o700 });
  const lock = join(directory, `${sha256("list:list")}.lock`);
  await writeFile(lock, "999999999");
  await assert.rejects(
    f.journal.withOwner(f.scope, async () => undefined),
    TaskOperationOwnershipError,
  );
  assert.equal(await readFile(lock, "utf8"), "999999999");
});

it("revokes sessions after ownership ends", async (t) => {
  const f = await fixture(t);
  let retained: TaskOperationJournalSession | undefined;
  await f.journal.withOwner(f.scope, async (session) => {
    retained = session;
  });
  assert.ok(retained);
  await assert.rejects(retained.read(), /ownership has ended/u);
  await assert.rejects(retained.write(f.record), /ownership has ended/u);
});

it("rejects corrupt journals without replacing their evidence", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "task-operations");
  await mkdir(directory, { mode: 0o700 });
  const path = join(directory, `${sha256("operation")}.json`);
  await writeFile(path, "{");
  await assert.rejects(
    f.journal.withOwner(f.scope, async (session) => session.read()),
    SyntaxError,
  );
  assert.equal(await readFile(path, "utf8"), "{");
});

it("resolves a known created ID to its original exact source before lifecycle finalization", async (t) => {
  const f = await fixture(t);
  await f.journal.withOwner(f.scope, async (session) => {
    await session.write(f.record);
    await session.write({ ...f.record, phase: "uncertain", taskId: "known" });
  });
  await writeFile(
    join(f.root, "task-operations", "source-not-a-journal.json"),
    "reservation evidence",
  );
  const identity = {
    target: f.record.plan.target,
    listId: "list",
    taskId: "known",
  };
  assert.deepEqual(await findTaskCreationSource(f.root, identity), {
    sourceOccurrenceId: "source/1",
    operationId: "operation",
    phase: "uncertain",
  });
  assert.equal(
    await findTaskCreationSource(f.root, { ...identity, taskId: "other" }),
    undefined,
  );
  assert.equal(
    await findTaskCreationSource(f.root, { ...identity, listId: "other" }),
    undefined,
  );
  assert.equal(
    await findTaskCreationSource(f.root, {
      ...identity,
      target: { ...identity.target, key: "other" },
    }),
    undefined,
  );
});
