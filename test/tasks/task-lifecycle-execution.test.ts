import assert from "node:assert/strict";
import { it } from "node:test";
import { createTaskLifecycleExecutionChecks } from "../../src/tasks/configured-task-executor.js";
import {
  emptyTaskLifecycleState,
  recordTaskLifecycle,
  type TaskLifecycleEntry,
} from "../../src/tasks/task-lifecycle.js";
import {
  nativeTaskTimingObservationDigest,
  unsupportedNativeTaskTimingObservation,
} from "../../src/tasks/native-task-timing.js";
import type { TaskExecutionPlan } from "../../src/tasks/task-execution-types.js";

function fixture() {
  const entry: TaskLifecycleEntry = {
    target: { kind: "module", key: "semester/fixture" },
    occurrenceId: "stable-source:occurrence",
    source: { kind: "assessment", id: "stable-source" },
    disposition: "active",
    recordedAt: "2026-10-28T08:00:00Z",
    evidenceRef: "operation:original",
    providers: [
      {
        canonical: { listId: "fixture-list", taskId: "canonical-task" },
        aliases: [
          {
            identity: { listId: "fixture-list", taskId: "verified-alias" },
            verifiedAt: "2026-10-28T07:00:00Z",
            evidenceRef: "fixture-exact-identity",
          },
        ],
      },
    ],
  };
  let state = recordTaskLifecycle(emptyTaskLifecycleState(), entry);
  let writes = 0;
  const session = {
    read: async () => structuredClone(state),
    record: async (entry: TaskLifecycleEntry) => {
      writes++;
      state = recordTaskLifecycle(state, entry);
      return state;
    },
  };
  const plan: TaskExecutionPlan = {
    schemaVersion: 1,
    operationId: "fixture-operation",
    target: { ...entry.target, title: "Fixture" },
    listId: "fixture-list",
    expectedSnapshot: "a".repeat(64),
    operation: { name: "complete", taskId: "canonical-task" },
    policyVersion: "fixture-policy",
  };
  const before = {
    plan,
    live: [],
    register: { listId: plan.listId, tasks: [] },
  };
  return {
    entry,
    plan,
    session,
    before,
    state: () => state,
    writes: () => writes,
  };
}

it("completion and dismissal resolve the original source occurrence through canonical and verified alias IDs", async () => {
  for (const name of ["complete", "cancel"] as const)
    for (const taskId of ["canonical-task", "verified-alias"]) {
      const test = fixture();
      test.plan.operation = { name, taskId };
      const checks = await createTaskLifecycleExecutionChecks(
        test.session,
        test.plan,
        () => "2026-10-28T09:00:00Z",
      );
      assert.equal(await checks.beforeWrite?.(test.before), undefined);
      await checks.afterApplied?.({ plan: test.plan, taskId, live: [] });
      assert.equal(test.state().entries.length, 1);
      const entry = test.state().entries[0];
      assert.ok(entry);
      assert.equal(entry.occurrenceId, "stable-source:occurrence");
      assert.equal(
        entry.disposition,
        name === "complete" ? "completed" : "owner-dismissed",
      );
      assert.deepEqual(entry.source, test.entry.source);
      assert.deepEqual(entry.providers, test.entry.providers);
    }
});

it("a conflicting caller source occurrence refuses before any lifecycle mutation", async () => {
  const test = fixture();
  test.plan.sourceOccurrenceId = "another-source:occurrence";
  const checks = await createTaskLifecycleExecutionChecks(
    test.session,
    test.plan,
  );
  assert.equal(
    await checks.beforeWrite?.(test.before),
    "source-occurrence-mismatch",
  );
  assert.equal(test.writes(), 0);
  await assert.rejects(
    checks.afterApplied?.({
      plan: test.plan,
      taskId: "canonical-task",
      live: [],
    }) ?? Promise.resolve(),
    /different source occurrence/u,
  );
  assert.equal(test.writes(), 0);
});

it("terminal replay preserves original disposition evidence and revision", async () => {
  const test = fixture();
  await test.session.record({ ...test.entry, disposition: "owner-dismissed" });
  const previous = test.state();
  const writes = test.writes();
  const checks = await createTaskLifecycleExecutionChecks(
    test.session,
    test.plan,
  );
  assert.equal(await checks.beforeWrite?.(test.before), "owner-dismissed");
  await checks.afterApplied?.({
    plan: test.plan,
    taskId: "canonical-task",
    live: [],
  });
  assert.equal(test.writes(), writes);
  assert.deepEqual(test.state(), previous);
});

it("native timing plans and date-only scheduling stay unsupported even without each other", async () => {
  for (const timing of [true, false]) {
    const test = fixture();
    test.plan.operation = {
      name: "change",
      taskId: "canonical-task",
      ...(timing ? { title: "Changed" } : { doDate: "2026-10-28" }),
    };
    if (timing)
      test.plan.timing = {
        schemaVersion: 1,
        planId: "fixture-timing",
        policyVersion: "fixture-policy",
        owner: "fixture-owner",
        observationDigest: nativeTaskTimingObservationDigest(
          unsupportedNativeTaskTimingObservation("adapter unavailable"),
        ),
        timeZone: "UTC",
        placements: [],
        availability: { dated: [], weekly: [] },
      };
    const checks = await createTaskLifecycleExecutionChecks(
      test.session,
      test.plan,
    );
    assert.equal(
      await checks.beforeWrite?.(test.before),
      "native-timing-unavailable",
    );
    assert.equal(test.writes(), 0);
  }
});

it("a dismissed logical occurrence refuses recreation under a new provider ID", async () => {
  const test = fixture();
  await test.session.record({ ...test.entry, disposition: "owner-dismissed" });
  test.plan.operation = { name: "create", title: "Same work recreated" };
  test.plan.sourceOccurrenceId = test.entry.occurrenceId;
  const checks = await createTaskLifecycleExecutionChecks(
    test.session,
    test.plan,
  );
  assert.equal(await checks.beforeWrite?.(test.before), "owner-dismissed");
});
