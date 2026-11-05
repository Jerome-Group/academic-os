import assert from "node:assert/strict";
import { it } from "node:test";
import {
  emptyTaskLifecycleState,
  parseTaskLifecycleState,
  recordTaskLifecycle,
  taskLifecycleDecision,
  type TaskLifecycleEntry,
} from "../../src/tasks/task-lifecycle.js";

function entry(
  disposition: TaskLifecycleEntry["disposition"] = "owner-dismissed",
): TaskLifecycleEntry {
  return {
    target: { kind: "module", key: "fixture-module" },
    occurrenceId: "source-1:occurrence-1",
    source: { kind: "learning-outcome", id: "source-1" },
    disposition,
    recordedAt: "2026-10-28T09:00:00Z",
    evidenceRef: "fixture-owner-instruction",
    providers: [
      {
        canonical: { listId: "fixture-list", taskId: "canonical-task" },
        aliases: [
          {
            identity: { listId: "fixture-list", taskId: "verified-ui-alias" },
            verifiedAt: "2026-10-28T08:59:00Z",
            evidenceRef: "fixture-native-identity-proof",
          },
        ],
      },
    ],
  };
}

it("terminal source occurrences block recreation despite new provider IDs", () => {
  for (const disposition of ["owner-dismissed", "completed"] as const) {
    const original = entry(disposition);
    const state = recordTaskLifecycle(emptyTaskLifecycleState(), original);
    assert.deepEqual(
      taskLifecycleDecision(state, {
        ...original,
        provider: { listId: "new-list", taskId: "new-task" },
      }),
      { allowed: false, reason: disposition },
    );
    assert.deepEqual(taskLifecycleDecision(state, original), {
      allowed: false,
      reason: disposition,
    });
    assert.deepEqual(
      taskLifecycleDecision(state, {
        ...original,
        target: { kind: "research-project", key: "other-target" },
      }),
      { allowed: true },
    );
  }
});

it("only canonical provider IDs and explicitly verified aliases match", () => {
  const original = entry();
  const state = recordTaskLifecycle(emptyTaskLifecycleState(), original);
  for (const taskId of ["canonical-task", "verified-ui-alias"]) {
    assert.equal(
      taskLifecycleDecision(state, {
        ...original,
        occurrenceId: "different-occurrence",
        provider: { listId: "fixture-list", taskId },
      }).allowed,
      false,
    );
  }
  for (const taskId of [
    "CANONICAL-TASK",
    Buffer.from("canonical-task").toString("base64url"),
    "similar-task-title",
  ]) {
    assert.deepEqual(
      taskLifecycleDecision(state, {
        ...original,
        occurrenceId: "different-occurrence",
        provider: { listId: "fixture-list", taskId },
      }),
      { allowed: true },
    );
  }
  assert.equal(
    taskLifecycleDecision(state, {
      ...original,
      occurrenceId: "other",
      provider: { listId: "other-list", taskId: "canonical-task" },
    }).allowed,
    true,
  );
});

it("keeps source identity and terminal disposition immutable while retaining new exact provider evidence", () => {
  const original = entry();
  const state = recordTaskLifecycle(emptyTaskLifecycleState(), original);
  assert.throws(
    () => recordTaskLifecycle(state, { ...original, disposition: "active" }),
    /cannot be reopened/u,
  );
  assert.throws(
    () =>
      recordTaskLifecycle(state, {
        ...original,
        source: { kind: "research", id: "new" },
      }),
    /cannot change its source/u,
  );
  assert.throws(
    () => recordTaskLifecycle(state, { ...original, providers: [] }),
    /retain exact provider/u,
  );
  const next = recordTaskLifecycle(state, {
    ...original,
    providers: [
      ...original.providers,
      {
        canonical: { listId: "fixture-list", taskId: "new-provider-id" },
        aliases: [],
      },
    ],
  });
  assert.equal(next.revision, 2);
  assert.equal(
    taskLifecycleDecision(next, {
      ...original,
      occurrenceId: "other",
      provider: { listId: "fixture-list", taskId: "new-provider-id" },
    }).allowed,
    false,
  );
  assert.equal(recordTaskLifecycle(state, original).revision, 1);
  assert.equal(state.entries[0]?.providers.length, 1);
});

it("rejects corrupt, unsupported, duplicated and ambiguous lifecycle records", () => {
  const state = recordTaskLifecycle(emptyTaskLifecycleState(), entry());
  for (const candidate of [
    { ...state, schemaVersion: 2 },
    { ...state, revision: -1 },
    { ...state, taskRegister: {} },
    { ...state, entries: [entry(), entry()] },
    { ...state, entries: [entry(), { ...entry(), occurrenceId: "other" }] },
    { ...state, entries: [{ ...entry(), recordedAt: "2026-10-28" }] },
    {
      ...state,
      entries: [
        {
          ...entry(),
          providers: [
            {
              canonical: { listId: "fixture-list", taskId: "canonical-task" },
              aliases: [
                { identity: { listId: "fixture-list", taskId: "alias" } },
              ],
            },
          ],
        },
      ],
    },
  ])
    assert.throws(() => parseTaskLifecycleState(candidate));
});

it("transitions active source occurrences to completed without losing provenance", () => {
  const active = entry("active");
  const state = recordTaskLifecycle(emptyTaskLifecycleState(), active);
  assert.equal(taskLifecycleDecision(state, active).allowed, true);
  const completed = recordTaskLifecycle(state, {
    ...active,
    disposition: "completed",
    recordedAt: "2026-10-28T10:00:00Z",
  });
  assert.deepEqual(completed.entries[0]?.source, active.source);
  assert.deepEqual(taskLifecycleDecision(completed, active), {
    allowed: false,
    reason: "completed",
  });
});
