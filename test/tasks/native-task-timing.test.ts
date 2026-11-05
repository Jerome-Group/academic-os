import assert from "node:assert/strict";
import { it } from "node:test";
import {
  nativeTaskTimingObservationDigest,
  parseNativeTaskTimingPlan,
  roundedNativeTaskMinutes,
  unsupportedNativeTaskTimingObservation,
  validateNativeTaskTimingPlan,
  type NativeTaskTimingObservation,
  type NativeTaskTimingPlan,
} from "../../src/tasks/native-task-timing.js";

type Observation = Extract<NativeTaskTimingObservation, { status: "observed" }>;
function observation(): Observation {
  return {
    schemaVersion: 1,
    status: "observed",
    observedAt: "2026-10-28T08:00:00Z",
    timeZone: "Asia/Singapore",
    horizon: {
      start: "2026-10-28T00:00:00+08:00",
      end: "2026-10-29T00:00:00+08:00",
    },
    complete: { tasks: true, busy: true, meals: true, protected: true },
    tasks: [
      {
        identity: {
          canonical: { listId: "fixture-list", taskId: "fixture-task" },
          aliases: [
            {
              identity: {
                listId: "fixture-list",
                taskId: "verified-native-id",
              },
              verifiedAt: "2026-10-28T07:59:00Z",
              evidenceRef: "fixture-identity-proof",
            },
          ],
        },
        timing: null,
        ownership: { kind: "managed", owner: "fixture-owner" },
        evidence: {
          surface: "native-task-editor",
          verifiedAt: "2026-10-28T08:00:00Z",
          reference: "fixture-native-readback",
        },
      },
    ],
    protectedIntervals: [],
  };
}
function plan(snapshot = observation()): NativeTaskTimingPlan {
  return {
    schemaVersion: 1,
    planId: "fixture-plan",
    policyVersion: "fixture-policy-v1",
    owner: "fixture-owner",
    observationDigest: nativeTaskTimingObservationDigest(snapshot),
    timeZone: "Asia/Singapore",
    placements: [
      {
        identity: { listId: "fixture-list", taskId: "fixture-task" },
        start: "2026-10-28T16:30:00+08:00",
        end: "2026-10-28T17:30:00+08:00",
        estimatedMinutes: 31,
      },
    ],
    availability: {
      dated: [],
      weekly: [
        { weekday: 3, windows: [{ startMinute: 8 * 60, endMinute: 22 * 60 }] },
      ],
    },
  };
}
function validate(
  snapshot = observation(),
  proposed = plan(snapshot),
  now = "2026-10-28T08:01:00Z",
) {
  return validateNativeTaskTimingPlan({
    observation: snapshot,
    plan: proposed,
    now,
    maxObservationAgeMs: 5 * 60_000,
  });
}

it("accepts exact fixed placements from fresh native evidence and keeps plan immutable", () => {
  const proposed = plan();
  const before = structuredClone(proposed);
  const result = validate(observation(), proposed);
  assert.equal(result.outcome, "accepted");
  assert.deepEqual(proposed, before);
  if (result.outcome === "accepted") {
    assert.deepEqual(result.plan, before);
    assert.notEqual(result.plan, proposed);
  }
  assert.deepEqual(
    [1, 30, 31, 60, 61].map(roundedNativeTaskMinutes),
    [30, 30, 60, 60, 90],
  );
});

it("reports unsupported native timing explicitly and never promotes a date-only due field", () => {
  const unsupported = unsupportedNativeTaskTimingObservation(
    "Native adapter has not passed acceptance.",
  );
  const result = validateNativeTaskTimingPlan({
    plan: plan(),
    observation: unsupported,
    now: "2026-10-28T08:01:00Z",
    maxObservationAgeMs: 300_000,
  });
  assert.deepEqual(result, {
    outcome: "refused",
    code: "unsupported",
    reason: "Native adapter has not passed acceptance.",
  });
  const snapshot = observation();
  Object.assign(first(snapshot.tasks), { due: "2026-10-28T00:00:00Z" });
  assert.equal(validate(snapshot, plan()).outcome, "refused");
});

it("fails closed for stale, future, missing, partial, changed and unsupported evidence", () => {
  assert.equal(
    validate(observation(), plan(), "2026-10-28T08:06:00Z").outcome,
    "refused",
  );
  assert.equal(
    validate(observation(), plan(), "2026-10-28T07:59:00Z").outcome,
    "refused",
  );
  for (const change of [
    (snapshot: Observation) => {
      first(snapshot.tasks).evidence.verifiedAt = "2026-10-28T07:00:00Z";
    },
    (snapshot: Observation) => {
      first(snapshot.tasks).evidence.verifiedAt = "2026-10-28T08:00:30Z";
    },
    (snapshot: Observation) => {
      snapshot.tasks = [];
    },
    (snapshot: Observation) => {
      Object.assign(snapshot.complete, { busy: false });
    },
    (snapshot: Observation) => {
      Object.assign(snapshot, { schemaVersion: 2 });
    },
    (snapshot: Observation) => {
      snapshot.timeZone = "Not/AZone";
    },
  ]) {
    const snapshot = observation();
    change(snapshot);
    assert.equal(validate(snapshot, plan()).outcome, "refused");
  }
  const changed = observation();
  first(changed.tasks).evidence.reference = "changed-readback";
  const result = validate(changed, plan());
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused")
    assert.equal(result.code, "changed-observation");
});

it("rejects descriptions as timing evidence even when they contain plausible times", () => {
  const snapshot = observation();
  Object.assign(first(snapshot.tasks).evidence, {
    surface: "task-description",
    description: "16:30-17:30",
  });
  assert.equal(validate(snapshot, plan()).outcome, "refused");
  assert.throws(
    () => parseNativeTaskTimingPlan({ ...plan(), description: "16:30-17:30" }),
    /descriptions/u,
  );
});

it("uses only exact canonical identities and verified aliases, never decoded guesses", () => {
  const snapshot = observation();
  const proposed = plan(snapshot);
  first(proposed.placements).identity.taskId = "verified-native-id";
  assert.equal(validate(snapshot, proposed).outcome, "accepted");
  first(proposed.placements).identity.taskId =
    Buffer.from("fixture-task").toString("base64url");
  assert.equal(validate(snapshot, proposed).outcome, "refused");
  first(proposed.placements).identity = {
    listId: "other-list",
    taskId: "fixture-task",
  };
  assert.equal(validate(snapshot, proposed).outcome, "refused");
});

it("rejects duplicate placements and ambiguous alias observations", () => {
  const proposed = plan();
  proposed.placements.push({
    ...first(proposed.placements),
    identity: { listId: "fixture-list", taskId: "verified-native-id" },
    start: "2026-10-28T18:00:00+08:00",
    end: "2026-10-28T19:00:00+08:00",
  });
  assert.equal(validate(observation(), proposed).outcome, "refused");
  const snapshot = observation();
  snapshot.tasks.push(structuredClone(first(snapshot.tasks)));
  assert.equal(validate(snapshot, plan()).outcome, "refused");
});

it("protects manual and other-owner placements, allowing exact retention only", () => {
  for (const ownership of [
    { kind: "manual" },
    { kind: "managed", owner: "another-owner" },
  ] as const) {
    const snapshot = observation();
    first(snapshot.tasks).ownership = ownership;
    first(snapshot.tasks).timing = {
      start: "2026-10-28T18:00:00+08:00",
      end: "2026-10-28T19:00:00+08:00",
    };
    const result = validate(snapshot);
    assert.equal(result.outcome, "refused");
    if (result.outcome === "refused")
      assert.equal(result.code, "manual-placement");
    const proposed = plan(snapshot);
    Object.assign(first(proposed.placements), first(snapshot.tasks).timing);
    assert.equal(validate(snapshot, proposed).outcome, "accepted");
  }
});

it("blocks Busy, meals, protected intervals and other Tasks but permits touching boundaries", () => {
  for (const kind of ["busy", "meal", "protected"] as const) {
    const snapshot = observation();
    snapshot.protectedIntervals.push({
      id: "blocked",
      kind,
      start: "2026-10-28T17:00:00+08:00",
      end: "2026-10-28T18:00:00+08:00",
    });
    assert.equal(validate(snapshot).outcome, "refused");
    first(snapshot.protectedIntervals).start = "2026-10-28T17:30:00+08:00";
    assert.equal(validate(snapshot).outcome, "accepted");
  }
  const snapshot = observation();
  const other = structuredClone(first(snapshot.tasks));
  other.identity = {
    canonical: { listId: "fixture-list", taskId: "other-task" },
    aliases: [],
  };
  other.timing = {
    start: "2026-10-28T17:00:00+08:00",
    end: "2026-10-28T18:00:00+08:00",
  };
  snapshot.tasks.push(other);
  assert.equal(validate(snapshot).outcome, "refused");
  const proposed = plan(snapshot);
  proposed.placements.push({
    identity: other.identity.canonical,
    ...other.timing,
    estimatedMinutes: 60,
  });
  assert.equal(validate(snapshot, proposed).outcome, "refused");
});

it("dated restrictions outrank weekly permission and use the explicit local timezone", () => {
  const proposed = plan();
  proposed.availability.dated.push({ date: "2026-10-28", windows: [] });
  assert.equal(validate(observation(), proposed).outcome, "refused");
  first(proposed.availability.dated).windows = [
    { startMinute: 16 * 60 + 30, endMinute: 17 * 60 + 30 },
  ];
  assert.equal(validate(observation(), proposed).outcome, "accepted");
  proposed.timeZone = "UTC";
  assert.equal(validate(observation(), proposed).outcome, "refused");
});

it("rejects unrounded, misaligned, unobserved and overnight slots without replanning", () => {
  for (const patch of [
    { estimatedMinutes: 61 },
    { estimatedMinutes: 0 },
    { estimatedMinutes: Number.NaN },
    { start: "2026-10-28T16:15:00+08:00", end: "2026-10-28T17:15:00+08:00" },
    {
      start: "2026-10-28T16:30:00.001+08:00",
      end: "2026-10-28T17:30:00.001+08:00",
    },
    { start: "2026-10-29T16:30:00+08:00", end: "2026-10-29T17:30:00+08:00" },
    { start: "2026-10-28T23:30:00+08:00", end: "2026-10-29T00:30:00+08:00" },
  ]) {
    const proposed = plan();
    Object.assign(first(proposed.placements), patch);
    const before = structuredClone(proposed);
    assert.equal(validate(observation(), proposed).outcome, "refused");
    assert.deepEqual(proposed, before);
  }
});

it("strictly parses versioned plans and binds observation fields independent of object key order", () => {
  const proposed = plan();
  assert.deepEqual(parseNativeTaskTimingPlan(proposed), proposed);
  for (const invalid of [
    null,
    {},
    { ...proposed, schemaVersion: 2 },
    {
      ...proposed,
      availability: {
        dated: [{ date: "2026-02-30", windows: [] }],
        weekly: [],
      },
    },
    {
      ...proposed,
      placements: [{ ...proposed.placements[0], notes: "schedule me" }],
    },
  ])
    assert.throws(() => parseNativeTaskTimingPlan(invalid));
  const snapshot = observation();
  assert.equal(
    nativeTaskTimingObservationDigest(snapshot),
    nativeTaskTimingObservationDigest({
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({
        evidence: task.evidence,
        ownership: task.ownership,
        timing: task.timing,
        identity: task.identity,
      })),
    }),
  );
});

function first<T>(values: T[]): T {
  const value = values[0];
  assert.ok(value !== undefined);
  return value;
}
