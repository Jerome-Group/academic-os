import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { parseStoredCalendarProposal } from "../../src/calendar/parse-stored-calendar-proposal.js";
import type {
  CalendarEvent,
  CalendarInterval,
  CalendarListEntry,
  CalendarStoredProposal,
} from "../../src/calendar/types.js";
import type { NtuWeekSelection } from "../../src/calendar/ntu-academic-calendar.js";
import { runCliWithEnvironment } from "../support/run-cli.js";

const roots: string[] = [];
const preload = new URL("../support/fake-calendar-preload.js", import.meta.url)
  .href;
const roles = ["Academic", "Commitments", "Routine"] as const;
const calendarIds = {
  Academic: "academic",
  Commitments: "commitments",
  Routine: "routine",
};
const source = { kind: "manual", reference: "synthetic-occupancy-regression" };
const start = "2026-10-05T10:00:00+08:00";
const end = "2026-10-05T11:00:00+08:00";
const point = (dateTime: string) => ({ dateTime, timeZone: "Asia/Singapore" });
const event = (id: string, first = start, last = end) => ({
  id,
  summary: id,
  visibility: "private",
  transparency: "opaque",
  start: point(first),
  end: point(last),
});
const master = () => ({
  ...event("series"),
  recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
});
const second = () => ({
  ...event(
    "selected",
    "2026-10-12T10:00:00+08:00",
    "2026-10-12T11:00:00+08:00",
  ),
  recurringEventId: "series",
  originalStartTime: point("2026-10-12T10:00:00+08:00"),
});
const timePatch = {
  start: point("2026-10-05T11:00:00+08:00"),
  end: point("2026-10-05T12:00:00+08:00"),
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("refuses overlapping timetable peers and preserves a nonoverlap/adjacency control", async () => {
  for (const [secondStart, expected] of [
    ["10:30", "blocked"],
    ["11:00", "ready"],
    ["12:00", "ready"],
  ]) {
    const fixture = await setup();
    const preview = await propose(fixture, timetable(secondStart ?? ""));
    assert.equal(preview.report.outcome, expected, JSON.stringify(preview));
    if (expected === "blocked") {
      assert.equal(preview.exitCode, 3);
      assert.equal(preview.report.conflicts.length, 1);
      assert.partialDeepStrictEqual(preview.report.conflicts[0], {
        source: "Proposed",
        proposedKey: "class-a",
        peerKey: "class-b",
      });
      await assert.rejects(
        readFile(join(fixture.calendarRoot, "pending-proposals.json")),
      );
    } else {
      const publication = await promote(fixture, preview.report.proposal.id);
      assert.equal(
        publication.report.outcome,
        "promoted",
        JSON.stringify(publication),
      );
      assert.equal((await provider(fixture)).events.academic.length, 2);
    }
    if (expected === "blocked")
      assert.equal(writes(await provider(fixture)), 0);
  }
});

it("checks a timetable's later peer occurrences from its recipe and ignores forged saved geometry", async () => {
  const fixture = await setup();
  const value = timetable("11:00");
  const firstClass = value.classes[0];
  assert.ok(firstClass);
  firstClass.weeks = { from: 10, to: 11 };
  const preview = await propose(fixture, value);
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  await alterProposal(fixture, (proposal) => {
    assert.ok(proposal.operation === "bulk-create");
    const item = proposal.items[1];
    assert.ok(item);
    assert.ok("dateTime" in item.intendedEvent.start);
    item.intendedEvent.start.dateTime = "2026-10-20T10:30:00+08:00";
    item.occupiedIntervals = [];
    proposal.relevantAvailabilityVersion.intervals = [];
  });
  const publication = await promote(fixture, preview.report.proposal.id);
  assert.notEqual(publication.report.outcome, "promoted");
  assert.equal(writes(await provider(fixture)), 0);
});

it("covers every finite occurrence and blocks the second week as well as its anchor control", async () => {
  for (const date of ["2026-10-05", "2026-10-12"]) {
    const series = { ...master(), recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"] };
    const busy = event(
      `busy-${date}`,
      `${date}T11:30:00+08:00`,
      `${date}T12:30:00+08:00`,
    );
    const fixture = await setup({ academic: [series], observed: [busy] });
    const preview = await propose(
      fixture,
      change("series", timePatch, "entire-series"),
    );
    assert.equal(preview.report.outcome, "blocked", JSON.stringify(preview));
    assert.equal(preview.report.conflicts[0].eventId, busy.id);
    assert.equal(writes(await provider(fixture)), 0);
  }
  const fixture = await setup({
    academic: [{ ...master(), recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"] }],
  });
  const preview = await propose(
    fixture,
    change("series", timePatch, "entire-series"),
  );
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  assert.deepEqual(
    preview.report.proposal.review.coverage.occurrences.map(
      (item: { interval: CalendarInterval }) => item.interval,
    ),
    [
      { start: "2026-10-05T03:00:00.000Z", end: "2026-10-05T04:00:00.000Z" },
      { start: "2026-10-12T03:00:00.000Z", end: "2026-10-12T04:00:00.000Z" },
    ],
  );
  const publication = await promote(fixture, preview.report.proposal.id);
  assert.equal(
    publication.report.outcome,
    "promoted",
    JSON.stringify(publication),
  );
  assert.equal(
    (await provider(fixture)).events.academic[0]?.start?.dateTime,
    timePatch.start.dateTime,
  );
});

it("rechecks a later conflict introduced after preview regardless of saved interval/digest/count claims", async () => {
  const fixture = await setup({ academic: [master()] });
  const preview = await propose(
    fixture,
    change("series", timePatch, "entire-series"),
  );
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  await alterProposal(fixture, (proposal) => {
    proposal.relevantAvailabilityVersion = {
      digest: "empty",
      interval: null,
      checkedCalendarCount: 0,
    };
    proposal.conflictSummary = { blockers: 0, warnings: 0 };
  });
  await mutate(fixture, (state) => {
    state.events.observed.push(
      event(
        "late-busy",
        "2026-10-19T11:00:00+08:00",
        "2026-10-19T12:00:00+08:00",
      ),
    );
  });
  const publication = await promote(fixture, preview.report.proposal.id);
  assert.equal(
    publication.report.outcome,
    "blocked",
    JSON.stringify(publication),
  );
  assert.equal(writes(await provider(fixture)), 0);
});

it("checks default-opaque restore availability and rejects blockers arriving after preview", async () => {
  for (const phase of ["preview", "promotion", "none"]) {
    const original: CalendarEvent = event("deleted");
    delete original.transparency;
    const fixture = await setup({
      tombstones: [
        { access: "owned", deletedAt: "2026-10-01T00:00:00Z", event: original },
      ],
    });
    if (phase === "preview")
      await mutate(fixture, (state) => {
        state.events.observed.push(event("busy"));
      });
    const preview = await propose(fixture, {
      operation: "restore",
      calendarRole: "Academic",
      eventId: "deleted",
    });
    assert.equal(
      preview.report.outcome,
      phase === "preview" ? "blocked" : "ready",
      JSON.stringify(preview),
    );
    if (phase === "preview")
      assert.equal(preview.report.conflicts[0].eventId, "busy");
    else {
      if (phase === "promotion")
        await mutate(fixture, (state) => {
          state.events.observed.push(event("busy"));
        });
      const publication = await promote(fixture, preview.report.proposal.id);
      assert.equal(
        publication.report.outcome,
        phase === "promotion" ? "blocked" : "promoted",
        JSON.stringify(publication),
      );
    }
    assert.equal(writes(await provider(fixture)), phase === "none" ? 1 : 0);
  }
});

it("requires re-preview for every unjournaled legacy proposal", async () => {
  for (const item of [
    fixed(),
    {
      ...fixed(),
      kind: "routine-event",
      calendarRole: "Routine",
      recurrence: ["RRULE:FREQ=DAILY"],
    },
    timetable("11:00"),
    change("series", { summary: "Renamed" }, "entire-series"),
    {
      operation: "cancel",
      calendarRole: "Academic",
      eventId: "series",
      recurrenceScope: "entire-series",
    },
    { operation: "restore", calendarRole: "Academic", eventId: "deleted" },
  ]) {
    const fixture = await setup({
      academic: [master()],
      tombstones: [
        {
          access: "owned",
          deletedAt: "2026-10-01T00:00:00Z",
          event: event("deleted"),
        },
      ],
    });
    const preview = await propose(fixture, item);
    assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
    await alterProposal(fixture, (proposal) => {
      delete proposal.review;
    });
    const publication = await promote(fixture, preview.report.proposal.id);
    assert.equal(
      publication.report.outcome,
      "stale",
      JSON.stringify(publication),
    );
    assert.match(publication.report.reason, /Legacy.*re-preview/u);
    assert.equal(writes(await provider(fixture)), 0);
  }
});

it("patches the master selected through an occurrence and keeps instance siblings in availability", async () => {
  const series = master();
  const selected = second();
  const fixture = await setup({ academic: [series, selected] });
  await mutate(fixture, (state) => {
    state.responsePages = { "academic/stored": [{ items: [series] }] };
  });
  const preview = await propose(
    fixture,
    change("selected", timePatch, "entire-series"),
  );
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  const publication = await promote(fixture, preview.report.proposal.id);
  assert.equal(
    publication.report.outcome,
    "promoted",
    JSON.stringify(publication),
  );
  assert.equal(
    (await provider(fixture)).requests
      ?.find(
        (request: { method: string; url: string }) =>
          request.method === "PATCH",
      )
      ?.url.endsWith("/events/series"),
    true,
  );
  const sibling = {
    ...event("sibling"),
    recurringEventId: "series",
    originalStartTime: point(start),
  };
  const instanceFixture = await setup({
    academic: [series, selected],
    occurrences: { academic: [sibling, selected] },
  });
  const blocked = await propose(
    instanceFixture,
    change(
      "selected",
      { start: point(start), end: point(end) },
      "this-occurrence",
    ),
  );
  assert.equal(blocked.report.outcome, "blocked", JSON.stringify(blocked));
  assert.equal(blocked.report.conflicts[0].eventId, "sibling");
  assert.equal(writes(await provider(instanceFixture)), 0);
});

it("preserves an unbounded busy metadata edit despite existing conflicts, and discloses Routine warning scope", async () => {
  const unbounded = { ...master(), recurrence: ["RRULE:FREQ=WEEKLY"] };
  const fixture = await setup({
    academic: [unbounded],
    observed: [event("existing-conflict")],
  });
  const preview = await propose(
    fixture,
    change("series", { summary: "Renamed" }, "entire-series"),
  );
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  assert.equal(
    preview.report.proposal.review.coverage.reason,
    "occupancy-preserving",
  );
  assert.equal(
    (await promote(fixture, preview.report.proposal.id)).report.outcome,
    "promoted",
  );
  const refusal = await propose(
    await setup({ academic: [unbounded] }),
    change("series", timePatch, "entire-series"),
  );
  assert.equal(refusal.exitCode, 2);
  assert.match(refusal.report.error.message, /unbounded busy/u);
  const routine = await setup({ observed: [event("routine-overlap")] });
  const warning = await propose(routine, {
    ...fixed(start, end),
    kind: "routine-event",
    calendarRole: "Routine",
    recurrence: ["RRULE:FREQ=DAILY"],
  });
  assert.equal(warning.report.outcome, "ready", JSON.stringify(warning));
  assert.equal(warning.report.warnings.length, 1);
  assert.equal(
    warning.report.proposal.review.coverage.warningCoverage,
    "anchor-only",
  );
});

it("uses inclusive UNTIL, EXDATE without COUNT refill, INTERVAL/BYDAY/WKST, and rejects unsupported grammar", async () => {
  const cases = [
    {
      rule: ["RRULE:FREQ=WEEKLY;UNTIL=20261019T020000Z"],
      expected: ["2026-10-05", "2026-10-12", "2026-10-19"],
    },
    {
      rule: [
        "RRULE:FREQ=DAILY;COUNT=3",
        "EXDATE;TZID=Asia/Singapore:20261005T100000",
      ],
      expected: ["2026-10-06", "2026-10-07"],
    },
    {
      rule: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=SU;COUNT=4"],
      expected: ["2026-10-05", "2026-10-07", "2026-10-19", "2026-10-21"],
    },
  ];
  for (const testCase of cases) {
    const fixture = await setup({
      academic: [{ ...master(), recurrence: testCase.rule }],
    });
    const preview = await propose(
      fixture,
      change(
        "series",
        { end: point("2026-10-05T11:30:00+08:00") },
        "entire-series",
      ),
    );
    assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
    assert.deepEqual(
      preview.report.proposal.review.coverage.occurrences.map(
        (item: { interval: CalendarInterval }) =>
          item.interval.start.slice(0, 10),
      ),
      testCase.expected,
    );
  }
  for (const recurrence of [
    ["RRULE:FREQ=MONTHLY;COUNT=2"],
    ["RRULE:FREQ=WEEKLY;COUNT=2;COUNT=3"],
    ["RRULE:FREQ=DAILY;COUNT=10001"],
    ["RRULE:FREQ=DAILY;COUNT=2", "RDATE:20261015T020000Z"],
  ]) {
    const fixture = await setup({ academic: [{ ...master(), recurrence }] });
    const preview = await propose(
      fixture,
      change("series", timePatch, "entire-series"),
    );
    assert.equal(preview.exitCode, 2, JSON.stringify(preview));
    assert.match(preview.report.error.message, /coverage unsupported/u);
    assert.equal(writes(await provider(fixture)), 0);
  }
});

it("binds empty-calendar membership even when the number of selected calendars is unchanged", async () => {
  const fixture = await setup();
  const preview = await propose(fixture, fixed());
  await mutate(fixture, (state) => {
    const observed = state.calendars.find(
      (calendar) => calendar.id === "observed",
    );
    assert.ok(observed);
    observed.id = "other-observed";
    state.events["other-observed"] = [];
  });
  const publication = await promote(fixture, preview.report.proposal.id);
  assert.equal(
    publication.report.outcome,
    "stale",
    JSON.stringify(publication),
  );
  assert.equal(writes(await provider(fixture)), 0);
});

it("checks UTC and Singapore all-day exclusive geometry and refuses historical Singapore recurrence", async () => {
  const fixture = await setup({
    tombstones: [
      {
        access: "owned",
        deletedAt: "2026-10-01T00:00:00Z",
        event: {
          id: "all-day",
          summary: "Busy day",
          start: { date: "2026-10-05" },
          end: { date: "2026-10-06" },
        },
      },
    ],
  });
  await mutate(fixture, (state) => {
    const academic = state.calendars[0];
    assert.ok(academic);
    academic.timeZone = "UTC";
    state.events.observed.push(
      event("last-hour", "2026-10-05T23:00:00Z", "2026-10-06T00:00:00Z"),
    );
  });
  const preview = await propose(fixture, {
    operation: "restore",
    calendarRole: "Academic",
    eventId: "all-day",
  });
  assert.equal(preview.report.outcome, "blocked", JSON.stringify(preview));
  const old = {
    ...master(),
    start: point("1981-12-30T10:00:00+07:30"),
    end: point("1981-12-30T11:00:00+07:30"),
  };
  const historical = await setup({ academic: [old] });
  const refusal = await propose(
    historical,
    change(
      "series",
      { end: point("1981-12-30T12:00:00+07:30") },
      "entire-series",
    ),
  );
  assert.equal(refusal.exitCode, 2, JSON.stringify(refusal));
  assert.match(refusal.report.error.message, /before 1982|Intl timezone/u);
});

it("continues empty provider pages and refuses a repeated pagination token before publication", async () => {
  for (const cycle of [false, true]) {
    const fixture = await setup();
    await mutate(fixture, (state) => {
      state.responsePages = {
        "observed/occurrences": [
          { items: [], nextPageToken: "1" },
          cycle
            ? { items: [], nextPageToken: "1" }
            : { items: [event("paged-conflict")] },
        ],
      };
    });
    const preview = await propose(fixture, fixed(start, end));
    assert.equal(preview.exitCode, cycle ? 2 : 3, JSON.stringify(preview));
    if (!cycle)
      assert.equal(preview.report.conflicts[0].eventId, "paged-conflict");
    assert.equal(writes(await provider(fixture)), 0);
  }
});

it("preserves accepted partial-batch effects and refuses every additional write after a new blocker", async () => {
  const fixture = await setup();
  const preview = await propose(fixture, timetable("11:00"));
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  await mutate(fixture, (state) => {
    state.eventCreateFailures = [preview.report.proposal.items[1].eventId];
  });
  const interrupted = await promote(fixture, preview.report.proposal.id);
  assert.equal(interrupted.exitCode, 2, JSON.stringify(interrupted));
  const accepted = await provider(fixture);
  const count = writes(accepted);
  assert.equal(accepted.events.academic.length, 1);
  await mutate(fixture, (state) => {
    state.events.observed.push(
      event(
        "new-blocker",
        "2026-10-20T11:00:00+08:00",
        "2026-10-20T12:00:00+08:00",
      ),
    );
  });
  const retry = await promote(fixture, preview.report.proposal.id);
  assert.equal(retry.report.outcome, "blocked", JSON.stringify(retry));
  assert.equal(retry.report.acceptedStepCount, 1);
  assert.equal(writes(await provider(fixture)), count);
  assert.equal((await provider(fixture)).events.academic.length, 1);
});

it("reassesses an interrupted move before its remaining PATCH", async () => {
  const fixture = await setup({ academic: [event("moving")] });
  const preview = await propose(fixture, {
    ...change("moving", timePatch),
    targetCalendarRole: "Commitments",
  });
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  await mutate(fixture, (state) => {
    state.patchFailures = ["moving"];
  });
  const interrupted = await promote(fixture, preview.report.proposal.id);
  assert.equal(interrupted.exitCode, 2, JSON.stringify(interrupted));
  const count = writes(await provider(fixture));
  await mutate(fixture, (state) => {
    state.events.observed.push(
      event(
        "new-blocker",
        "2026-10-05T11:00:00+08:00",
        "2026-10-05T12:00:00+08:00",
      ),
    );
  });
  const retry = await promote(fixture, preview.report.proposal.id);
  assert.equal(retry.report.outcome, "blocked", JSON.stringify(retry));
  assert.equal(retry.report.acceptedStepCount, 1);
  assert.equal(writes(await provider(fixture)), count);
  assert.equal(
    (await provider(fixture)).events.commitments[0]?.start?.dateTime,
    start,
  );
});

it("counts cancelled original positions and refuses uncertain future exception remapping before trimming", async () => {
  const cancelled = {
    id: "cancelled-first",
    status: "cancelled",
    recurringEventId: "series",
    originalStartTime: point(start),
  };
  const fixture = await setup({ academic: [master(), second(), cancelled] });
  const preview = await propose(
    fixture,
    change(
      "selected",
      {
        start: point("2026-10-12T11:00:00+08:00"),
        end: point("2026-10-12T12:00:00+08:00"),
      },
      "this-and-future",
    ),
  );
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  const publication = await promote(fixture, preview.report.proposal.id);
  assert.equal(
    publication.report.outcome,
    "promoted",
    JSON.stringify(publication),
  );
  assert.deepEqual(
    (await provider(fixture)).events.academic.find(
      (item: CalendarEvent) =>
        item.id !== "series" && item.recurrence !== undefined,
    )?.recurrence,
    ["RRULE:FREQ=WEEKLY;COUNT=2"],
  );
  const exception = {
    ...event(
      "override",
      "2026-10-19T15:00:00+08:00",
      "2026-10-19T16:00:00+08:00",
    ),
    recurringEventId: "series",
    originalStartTime: point("2026-10-19T10:00:00+08:00"),
  };
  const refusalFixture = await setup({
    academic: [master(), second(), exception],
  });
  const refusal = await propose(
    refusalFixture,
    change(
      "selected",
      {
        start: point("2026-10-12T11:00:00+08:00"),
        end: point("2026-10-12T12:00:00+08:00"),
      },
      "this-and-future",
    ),
  );
  assert.equal(refusal.exitCode, 2, JSON.stringify(refusal));
  assert.match(refusal.report.error.message, /cannot be remapped exactly/u);
  assert.equal(writes(await provider(refusalFixture)), 0);
});

it("rechecks exact future trim/create/replay prefixes and preserves approved exception metadata", async () => {
  const override = {
    ...event(
      "override",
      "2026-10-19T15:00:00+08:00",
      "2026-10-19T16:00:00+08:00",
    ),
    recurringEventId: "series",
    originalStartTime: point("2026-10-19T10:00:00+08:00"),
    description: "approved detached detail",
    location: "synthetic room",
    extendedProperties: { private: { retained: "yes" } },
  };
  const fixture = await setup({ routine: [master(), second(), override] });
  const preview = await propose(fixture, {
    ...change("selected", { summary: "future summary" }, "this-and-future"),
    calendarRole: "Routine",
    targetCalendarRole: "Academic",
  });
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  assert.deepEqual(
    preview.report.proposal.review.coverage.occurrences.map(
      (item: { interval: CalendarInterval }) => item.interval,
    ),
    [
      { start: "2026-10-12T02:00:00.000Z", end: "2026-10-12T03:00:00.000Z" },
      { start: "2026-10-19T07:00:00.000Z", end: "2026-10-19T08:00:00.000Z" },
    ],
  );
  const key = preview.report.proposal.idempotencyKey;
  const futureId = `a${createHash("sha256").update(key).digest("hex").slice(0, 31)}`;
  await mutate(fixture, (state) => {
    state.instanceEvents = {
      [`academic/${futureId}/2026-10-19T02:00:00.000Z`]: [
        {
          ...event(
            "replacement-override",
            "2026-10-19T10:00:00+08:00",
            "2026-10-19T11:00:00+08:00",
          ),
          summary: "future summary",
          recurringEventId: futureId,
          originalStartTime: point("2026-10-19T10:00:00+08:00"),
          extendedProperties: { private: { academicOsIdempotencyKey: key } },
        },
      ],
    };
    state.patchFailures = ["replacement-override"];
  });
  const interrupted = await promote(fixture, preview.report.proposal.id);
  assert.equal(interrupted.exitCode, 2, JSON.stringify(interrupted));
  const partial = await provider(fixture);
  const count = writes(partial);
  assert.equal(partial.events.routine.length, 1);
  assert.equal(partial.events.academic[0]?.id, futureId);
  assert.deepEqual(partial.events.routine[0]?.recurrence, [
    "RRULE:FREQ=WEEKLY;UNTIL=20261012T015959Z",
  ]);
  await mutate(fixture, (state) => {
    state.events.observed.push(
      event(
        "later-blocker",
        "2026-10-19T15:00:00+08:00",
        "2026-10-19T16:00:00+08:00",
      ),
    );
  });
  const blocked = await promote(fixture, preview.report.proposal.id);
  assert.equal(blocked.report.outcome, "blocked", JSON.stringify(blocked));
  assert.equal(blocked.report.acceptedStepCount, 4);
  assert.equal(writes(await provider(fixture)), count);
  await mutate(fixture, (state) => {
    state.events.observed = [];
  });
  const retry = await promote(fixture, preview.report.proposal.id);
  assert.equal(retry.report.outcome, "promoted", JSON.stringify(retry));
  const complete = await provider(fixture);
  const replayed = complete.events.academic.find(
    ({ id }) => id === "replacement-override",
  );
  assert.partialDeepStrictEqual(replayed, {
    description: override.description,
    location: override.location,
    extendedProperties: override.extendedProperties,
    start: override.start,
    end: override.end,
  });
  const completedWrites = writes(complete);
  const receipt = await promote(fixture, preview.report.proposal.id);
  assert.equal(receipt.report.outcome, "retry", JSON.stringify(receipt));
  assert.equal(writes(await provider(fixture)), completedWrites);
  await mutate(fixture, (state) => {
    const changed = state.events.academic.find(
      ({ id }) => id === "replacement-override",
    );
    assert.ok(changed);
    changed.location = "unexpected";
  });
  const drift = await promote(fixture, preview.report.proposal.id);
  assert.notEqual(drift.report.outcome, "retry", JSON.stringify(drift));
  assert.equal(writes(await provider(fixture)), completedWrites);
});

it("refuses a new later blocker after source trimming and before replacement creation", async () => {
  const fixture = await setup({ academic: [master(), second()] });
  const preview = await propose(
    fixture,
    change(
      "selected",
      {
        start: point("2026-10-12T11:00:00+08:00"),
        end: point("2026-10-12T12:00:00+08:00"),
      },
      "this-and-future",
    ),
  );
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  const key = preview.report.proposal.idempotencyKey;
  await mutate(fixture, (state) => {
    state.eventCreateFailures = [
      `a${createHash("sha256").update(key).digest("hex").slice(0, 31)}`,
    ];
  });
  const interrupted = await promote(fixture, preview.report.proposal.id);
  assert.equal(interrupted.exitCode, 2, JSON.stringify(interrupted));
  const count = writes(await provider(fixture));
  await mutate(fixture, (state) => {
    state.events.observed.push(
      event(
        "later-blocker",
        "2026-10-19T11:00:00+08:00",
        "2026-10-19T12:00:00+08:00",
      ),
    );
  });
  const retry = await promote(fixture, preview.report.proposal.id);
  assert.equal(retry.report.outcome, "blocked", JSON.stringify(retry));
  assert.equal(retry.report.acceptedStepCount, 2);
  assert.equal(writes(await provider(fixture)), count);
});

it("keeps prefix exceptions by original identity and distinguishes equal IDs on different calendars", async () => {
  const prior = {
    ...event("prior", "2026-10-19T11:00:00+08:00", "2026-10-19T12:00:00+08:00"),
    recurringEventId: "series",
    originalStartTime: point(start),
  };
  const fixture = await setup({ academic: [master(), second(), prior] });
  const preview = await propose(
    fixture,
    change(
      "selected",
      {
        start: point("2026-10-12T11:00:00+08:00"),
        end: point("2026-10-12T12:00:00+08:00"),
      },
      "this-and-future",
    ),
  );
  assert.equal(preview.report.outcome, "blocked", JSON.stringify(preview));
  assert.equal(preview.report.conflicts[0].eventId, "prior");
  assert.equal(writes(await provider(fixture)), 0);
  const sameId = await setup({
    academic: [event("equal")],
    observed: [
      event("equal", "2026-10-05T11:00:00+08:00", "2026-10-05T12:00:00+08:00"),
    ],
  });
  const conflict = await propose(sameId, change("equal", timePatch));
  assert.equal(conflict.report.outcome, "blocked", JSON.stringify(conflict));
  assert.equal(conflict.report.conflicts[0].source, "Observed");
});

it("rejects invalid geometry before milestone and metadata exemptions, with exact instant controls", async () => {
  for (const item of [
    {
      ...fixed(),
      kind: "timed-milestone",
      end: point("2026-10-20T08:00:00+08:00"),
    },
    { ...fixed(), start: point("2026-02-30T09:00:00+08:00") },
  ]) {
    const fixture = await setup();
    const preview = await propose(fixture, item);
    assert.equal(preview.exitCode, 2, JSON.stringify(preview));
    assert.equal(writes(await provider(fixture)), 0);
  }
  const { end: _missingEnd, ...incomplete } = master();
  const invalid = await setup({ academic: [incomplete] });
  const refused = await propose(
    invalid,
    change("series", { summary: "metadata" }, "entire-series"),
  );
  assert.equal(refused.exitCode, 2, JSON.stringify(refused));
  const exact = await setup({
    observed: [
      event("adjacent", "2026-10-20T01:00:00.000Z", "2026-10-20T01:00:00.001Z"),
    ],
  });
  const okay = await propose(
    exact,
    fixed("2026-10-20T01:00:00.001Z", "2026-10-20T01:00:00.002Z"),
  );
  assert.equal(okay.report.outcome, "ready", JSON.stringify(okay));
  assert.deepEqual(
    okay.report.proposal.review.coverage.occurrences[0].interval,
    { start: "2026-10-20T01:00:00.001Z", end: "2026-10-20T01:00:00.002Z" },
  );
});

it("binds review engine and complete occurrence evidence rather than trusting saved proof fields", async () => {
  for (const part of ["engine", "coverage", "intent"]) {
    const fixture = await setup();
    const preview = await propose(fixture, fixed());
    assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
    await alterProposal(fixture, (proposal) => {
      assert.ok(proposal.review);
      if (part === "engine") proposal.review.engine.tz = "different";
      if (part === "coverage") proposal.review.coverage.occurrences = [];
      if (part === "intent") {
        assert.equal(proposal.operation, "create");
        if (proposal.operation === "create")
          proposal.intendedEvent.summary = "unreviewed";
      }
    });
    const publication = await promote(fixture, preview.report.proposal.id);
    assert.equal(
      publication.report.outcome,
      "stale",
      JSON.stringify(publication),
    );
    assert.equal(writes(await provider(fixture)), 0);
  }
});

it("compares independently listed NTU semester dates including recess and no-class exclusions", async () => {
  const fixture = await setup();
  const value = timetable("12:00", { from: 1, to: 13 });
  value.classes = value.classes.slice(0, 1);
  const first = value.classes[0];
  assert.ok(first);
  first.weekday = "MO";
  const preview = await propose(fixture, value);
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  assert.deepEqual(
    preview.report.proposal.review.coverage.occurrences.map(
      (item: { interval: CalendarInterval }) =>
        item.interval.start.slice(0, 10),
    ),
    [
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ],
  );
});

it("keeps all-excluded finite sets and supported UTC recurrence exact, with explicit zone/budget refusals", async () => {
  const excluded = await setup({
    academic: [
      {
        ...master(),
        recurrence: [
          "RRULE:FREQ=WEEKLY;COUNT=2",
          "EXDATE:20261005T020000Z,20261012T020000Z",
        ],
      },
    ],
  });
  const preview = await propose(
    excluded,
    change("series", timePatch, "entire-series"),
  );
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  // Exclusions are immutable original starts: changing the time does not silently move EXDATE.
  assert.equal(preview.report.proposal.review.coverage.occurrences.length, 2);
  const noOccupancy = await propose(
    await setup({
      academic: [
        {
          ...master(),
          recurrence: [
            "RRULE:FREQ=WEEKLY;COUNT=2",
            "EXDATE:20261005T020000Z,20261012T020000Z",
          ],
        },
      ],
    }),
    change(
      "series",
      { end: point("2026-10-05T12:00:00+08:00") },
      "entire-series",
    ),
  );
  assert.equal(
    noOccupancy.report.proposal.review.coverage.occurrences.length,
    0,
  );
  for (const zone of ["UTC", "Europe/London"]) {
    const series = {
      ...master(),
      start: { dateTime: "2026-10-05T10:00:00Z", timeZone: zone },
      end: { dateTime: "2026-10-05T11:00:00Z", timeZone: zone },
    };
    const fixture = await setup({ academic: [series] });
    const result = await propose(
      fixture,
      change(
        "series",
        { end: { dateTime: "2026-10-05T12:00:00Z", timeZone: zone } },
        "entire-series",
      ),
    );
    assert.equal(
      result.exitCode,
      zone === "UTC" ? 0 : 2,
      JSON.stringify(result),
    );
    if (zone === "UTC")
      assert.deepEqual(
        result.report.proposal.review.coverage.occurrences.map(
          (item: { interval: CalendarInterval }) => item.interval.start,
        ),
        [
          "2026-10-05T10:00:00.000Z",
          "2026-10-12T10:00:00.000Z",
          "2026-10-19T10:00:00.000Z",
        ],
      );
    assert.equal(writes(await provider(fixture)), 0);
  }
  const budget = await setup({
    academic: [
      { ...master(), recurrence: ["RRULE:FREQ=DAILY;INTERVAL=100001;COUNT=2"] },
    ],
  });
  const result = await propose(
    budget,
    change("series", timePatch, "entire-series"),
  );
  assert.equal(result.exitCode, 2, JSON.stringify(result));
  assert.match(result.report.error.message, /iteration budget/u);
});

it("checks later timetable peers and overlapping occurrences within one changed series", async () => {
  const fixture = await setup();
  const value = timetable("10:30", { from: 10, to: 11 });
  const later = value.classes[1];
  assert.ok(later);
  later.weeks = { week: 11 };
  const overlap = await propose(fixture, value);
  assert.equal(overlap.report.outcome, "blocked", JSON.stringify(overlap));
  assert.equal(overlap.report.conflicts[0].start.slice(0, 10), "2026-10-27");
  const series = await setup({ academic: [master()] });
  const same = await propose(
    series,
    change(
      "series",
      { end: point("2026-10-13T11:00:00+08:00") },
      "entire-series",
    ),
  );
  assert.equal(same.report.outcome, "blocked", JSON.stringify(same));
  assert.equal(same.report.conflicts[0].source, "Proposed");
  assert.notEqual(
    same.report.conflicts[0].originalStart,
    same.report.conflicts[0].peerOriginalStart,
  );
});

it("checks complete paginated sparse exceptions and rejects new exception membership before trimming", async () => {
  const cancelled = {
    id: "sparse",
    status: "cancelled",
    recurringEventId: "series",
    originalStartTime: point("2026-10-19T10:00:00+08:00"),
  };
  const fixture = await setup({ academic: [master(), second(), cancelled] });
  await mutate(fixture, (state) => {
    state.responsePages = {
      "academic/stored": [
        { items: [], nextPageToken: "1" },
        { items: [master(), second(), cancelled] },
      ],
    };
  });
  const preview = await propose(
    fixture,
    change(
      "selected",
      {
        start: point("2026-10-12T11:00:00+08:00"),
        end: point("2026-10-12T12:00:00+08:00"),
      },
      "this-and-future",
    ),
  );
  // An exact cancellation still needs remapping when its original no longer exists in the new anchor.
  assert.equal(preview.exitCode, 2, JSON.stringify(preview));
  assert.equal(writes(await provider(fixture)), 0);
  const changed = await setup({ academic: [master(), second()] });
  const ready = await propose(
    changed,
    change(
      "selected",
      {
        start: point("2026-10-12T11:00:00+08:00"),
        end: point("2026-10-12T12:00:00+08:00"),
      },
      "this-and-future",
    ),
  );
  assert.equal(ready.report.outcome, "ready", JSON.stringify(ready));
  await mutate(changed, (state) => {
    state.events.academic.push(cancelled);
  });
  const stale = await promote(changed, ready.report.proposal.id);
  assert.equal(stale.report.outcome, "stale", JSON.stringify(stale));
  assert.equal(writes(await provider(changed)), 0);
});

it("retains cancellation and transparent Routine restoration without finite busy expansion", async () => {
  for (const first of [false, true]) {
    const selected = first
      ? {
          ...second(),
          start: point(start),
          end: point(end),
          originalStartTime: point(start),
        }
      : second();
    const fixture = await setup({
      academic: [{ ...master(), recurrence: ["RRULE:FREQ=WEEKLY"] }, selected],
      observed: [event("existing")],
    });
    const preview = await propose(fixture, {
      operation: "cancel",
      calendarRole: "Academic",
      eventId: "selected",
      recurrenceScope: "this-and-future",
    });
    assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
    assert.equal(
      preview.report.proposal.review.coverage.reason,
      "cancellation",
    );
    const publication = await promote(fixture, preview.report.proposal.id);
    assert.equal(
      publication.report.outcome,
      "promoted",
      JSON.stringify(publication),
    );
    const state = await provider(fixture);
    if (first)
      assert.equal(
        state.events.academic.some(({ id }) => id === "series"),
        false,
      );
    else
      assert.deepEqual(
        state.events.academic.find(({ id }) => id === "series")?.recurrence,
        ["RRULE:FREQ=WEEKLY;UNTIL=20261012T015959Z"],
      );
  }
  const retained = {
    ...master(),
    transparency: "transparent",
    recurrence: ["RRULE:FREQ=DAILY"],
  };
  const fixture = await setup({
    tombstoneRole: "Routine",
    tombstones: [
      { access: "owned", deletedAt: "2026-10-01T00:00:00Z", event: retained },
    ],
    observed: [event("existing")],
  });
  const preview = await propose(fixture, {
    operation: "restore",
    calendarRole: "Routine",
    eventId: "series",
  });
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  assert.equal(preview.report.proposal.review.coverage.reason, "routine");
  assert.equal(
    preview.report.proposal.review.coverage.restorationScope,
    "retained-resource-only",
  );
  assert.equal(preview.report.warnings.length, 1);
  assert.equal(
    (await promote(fixture, preview.report.proposal.id)).report.outcome,
    "promoted",
  );
  assert.deepEqual(
    (await provider(fixture)).events.routine[0]?.recurrence,
    retained.recurrence,
  );
});

it("converts recurring offset instants into their declared zone and rejects inconsistent start/end zones", async () => {
  const series = {
    ...master(),
    start: point("2026-10-05T02:00:00Z"),
    end: point("2026-10-05T03:00:00Z"),
  };
  const fixture = await setup({ academic: [series] });
  const result = await propose(
    fixture,
    change("series", { end: point("2026-10-05T04:00:00Z") }, "entire-series"),
  );
  assert.equal(result.report.outcome, "ready", JSON.stringify(result));
  assert.deepEqual(
    result.report.proposal.review.coverage.occurrences.map(
      (item: { interval: CalendarInterval }) => item.interval.start,
    ),
    [
      "2026-10-05T02:00:00.000Z",
      "2026-10-12T02:00:00.000Z",
      "2026-10-19T02:00:00.000Z",
    ],
  );
  const mismatch = await setup({ academic: [master()] });
  const refused = await propose(
    mismatch,
    change(
      "series",
      { end: { dateTime: "2026-10-05T04:00:00Z", timeZone: "UTC" } },
      "entire-series",
    ),
  );
  assert.equal(refused.exitCode, 2, JSON.stringify(refused));
  assert.match(refused.report.error.message, /zones must agree/u);
});

it("refuses ownership drift in an original override retained after source trimming", async () => {
  const fixture = await setup({ academic: [master(), second()] });
  const preview = await propose(
    fixture,
    change(
      "selected",
      {
        start: point("2026-10-12T11:00:00+08:00"),
        end: point("2026-10-12T12:00:00+08:00"),
      },
      "this-and-future",
    ),
  );
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  await mutate(fixture, (state) => {
    state.deleteFailures = ["selected"];
  });
  const partial = await promote(fixture, preview.report.proposal.id);
  assert.equal(partial.exitCode, 2, JSON.stringify(partial));
  const count = writes(await provider(fixture));
  await mutate(fixture, (state) => {
    const selected = state.events.academic.find(({ id }) => id === "selected");
    assert.ok(selected);
    selected.organizer = { self: false, email: "other@example.invalid" };
  });
  const retry = await promote(fixture, preview.report.proposal.id);
  assert.equal(retry.report.outcome, "stale", JSON.stringify(retry));
  assert.equal(writes(await provider(fixture)), count);
});

it("refuses ambiguous duplicate original anchors in the complete source inventory", async () => {
  const first = {
    ...event(
      "first-override",
      "2026-10-19T15:00:00+08:00",
      "2026-10-19T16:00:00+08:00",
    ),
    recurringEventId: "series",
    originalStartTime: point("2026-10-19T10:00:00+08:00"),
  };
  const other = {
    ...first,
    id: "other-override",
    start: point("2026-10-19T17:00:00+08:00"),
    end: point("2026-10-19T18:00:00+08:00"),
  };
  const fixture = await setup({ routine: [master(), second(), first, other] });
  const result = await propose(fixture, {
    ...change("selected", { summary: "future" }, "this-and-future"),
    calendarRole: "Routine",
    targetCalendarRole: "Academic",
  });
  assert.equal(result.exitCode, 2, JSON.stringify(result));
  assert.match(result.report.error.message, /original occurrence identity/u);
  assert.equal(writes(await provider(fixture)), 0);
});

it("requires EXDATE value kind to agree with DTSTART and retains explicit all-day DATE exclusion", async () => {
  const fixture = await setup({
    academic: [
      {
        ...master(),
        recurrence: [
          "RRULE:FREQ=WEEKLY;COUNT=2",
          "EXDATE;VALUE=DATE:20261005T020000Z",
        ],
      },
    ],
  });
  const result = await propose(
    fixture,
    change(
      "series",
      { end: point("2026-10-05T12:00:00+08:00") },
      "entire-series",
    ),
  );
  assert.equal(result.exitCode, 2, JSON.stringify(result));
  assert.match(result.report.error.message, /value kind/u);
  assert.equal(writes(await provider(fixture)), 0);
  const allDay = await setup({
    tombstones: [
      {
        access: "owned",
        deletedAt: "2026-10-01T00:00:00Z",
        event: {
          id: "all-day",
          start: { date: "2026-10-05" },
          end: { date: "2026-10-06" },
          recurrence: [
            "RRULE:FREQ=DAILY;COUNT=2",
            "EXDATE;VALUE=DATE:20261006",
          ],
        },
      },
    ],
  });
  const valid = await propose(allDay, {
    operation: "restore",
    calendarRole: "Academic",
    eventId: "all-day",
  });
  assert.equal(valid.report.outcome, "ready", JSON.stringify(valid));
  assert.deepEqual(
    valid.report.proposal.review.coverage.occurrences.map(
      (item: { interval: CalendarInterval }) => item.interval,
    ),
    [{ start: "2026-10-04T16:00:00.000Z", end: "2026-10-05T16:00:00.000Z" }],
  );
  const rdate = await setup({
    academic: [
      {
        ...master(),
        recurrence: ["RRULE:FREQ=WEEKLY", "RDATE:20261020T020000Z"],
      },
      second(),
    ],
  });
  const cancellation = await propose(rdate, {
    operation: "cancel",
    calendarRole: "Academic",
    eventId: "selected",
    recurrenceScope: "this-and-future",
  });
  assert.equal(cancellation.exitCode, 2, JSON.stringify(cancellation));
  assert.match(cancellation.report.error.message, /cannot trim RDATE/u);
  assert.equal(writes(await provider(rdate)), 0);
});

it("rejects stored enum arrays as invalid state before any promotion provider read", async () => {
  for (const field of [
    "status",
    "itemKind",
    "recurrenceScope",
    "kind",
    "warningCoverage",
    "reason",
  ]) {
    const fixture = await setup({ academic: [master(), second()] });
    const preview = await propose(
      fixture,
      change("selected", { summary: "Metadata" }, "this-occurrence"),
    );
    assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
    const path = join(fixture.calendarRoot, "pending-proposals.json");
    const stored: unknown = JSON.parse(await readFile(path, "utf8"));
    assert.ok(record(stored) && Array.isArray(stored.proposals));
    const proposal: unknown = stored.proposals[0];
    assert.ok(record(proposal));
    let target = proposal;
    if (["kind", "warningCoverage", "reason"].includes(field)) {
      assert.ok(record(proposal.review) && record(proposal.review.coverage));
      target = proposal.review.coverage;
    }
    assert.equal(typeof target[field], "string");
    target[field] = [target[field]];
    await writeFile(path, JSON.stringify(stored));
    const reads = (await provider(fixture)).requests?.length;
    const result = await promote(fixture, preview.report.proposal.id);
    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.equal(result.report.error.code, "operational-failure");
    assert.match(
      result.report.error.message,
      /private pending Calendar Proposal is invalid; re-preview/u,
    );
    assert.equal((await provider(fixture)).requests?.length, reads);
    assert.equal(writes(await provider(fixture)), 0);
  }
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

it("requires exact current owner access for every configured Owned calendar before preview and promotion", async () => {
  for (const role of roles) {
    for (const access of [
      "writer",
      "reader",
      "freeBusyReader",
      undefined,
      null,
      false,
      ["owner"],
      "OWNER",
    ]) {
      for (const phase of ["preview", "promotion"]) {
        const fixture = await setup();
        const approved =
          phase === "promotion" ? await propose(fixture, fixed()) : undefined;
        if (approved !== undefined)
          assert.equal(
            approved.report.outcome,
            "ready",
            JSON.stringify(approved),
          );
        const path = join(fixture.calendarRoot, "pending-proposals.json");
        const before =
          approved === undefined ? undefined : await readFile(path, "utf8");
        const raw: unknown = JSON.parse(
          await readFile(fixture.providerPath, "utf8"),
        );
        assert.ok(record(raw) && Array.isArray(raw.calendars));
        const calendar: unknown = raw.calendars.find(
          (value: unknown) => record(value) && value.id === calendarIds[role],
        );
        assert.ok(record(calendar));
        if (access === undefined) delete calendar.accessRole;
        else calendar.accessRole = access;
        await writeFile(fixture.providerPath, JSON.stringify(raw));
        const result =
          approved === undefined
            ? await propose(fixture, fixed())
            : await promote(fixture, approved.report.proposal.id);
        assert.equal(
          result.exitCode,
          2,
          JSON.stringify({ role, access, phase, result }),
        );
        assert.match(result.report.error.message, /current.*owner/u);
        assert.equal(writes(await provider(fixture)), 0);
        if (before === undefined)
          await assert.rejects(readFile(path), { code: "ENOENT" });
        else assert.equal(await readFile(path, "utf8"), before);
      }
    }
  }
  const owner = await setup();
  const ready = await propose(owner, fixed());
  assert.equal(ready.report.outcome, "ready", JSON.stringify(ready));
  assert.equal(
    (await promote(owner, ready.report.proposal.id)).report.outcome,
    "promoted",
  );
  const observed = await setup({
    observed: [
      event(
        "read-only-observed",
        "2026-10-20T09:00:00+08:00",
        "2026-10-20T10:00:00+08:00",
      ),
    ],
  });
  const conflict = await propose(observed, fixed());
  assert.equal(conflict.report.outcome, "blocked", JSON.stringify(conflict));
  assert.equal(conflict.report.conflicts[0].source, "Observed");
  assert.equal(writes(await provider(observed)), 0);
});

interface ProviderState {
  calendars: CalendarListEntry[];
  events: {
    academic: CalendarEvent[];
    commitments: CalendarEvent[];
    routine: CalendarEvent[];
    observed: CalendarEvent[];
    [key: string]: CalendarEvent[];
  };
  requests?: Array<{
    method: string;
    url: string;
    params?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }>;
  responsePages?: Record<
    string,
    Array<{ items: CalendarEvent[]; nextPageToken?: string }>
  >;
  eventCreateFailures?: string[];
  patchFailures?: string[];
  deleteFailures?: string[];
  instanceEvents?: Record<string, CalendarEvent[]>;
}

interface Fixture {
  config: string;
  calendarRoot: string;
  root: string;
  providerPath: string;
}
async function setup(
  input: {
    academic?: CalendarEvent[];
    routine?: CalendarEvent[];
    observed?: CalendarEvent[];
    tombstones?: unknown[];
    tombstoneRole?: "Academic" | "Routine";
    occurrences?: Record<string, CalendarEvent[]>;
  } = {},
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-occupancy-"));
  roots.push(root);
  const stateRoot = join(root, "State");
  const calendarRoot = join(stateRoot, "calendar");
  await mkdir(join(root, "Drive"));
  await mkdir(join(calendarRoot, "mirrors"), { recursive: true });
  const config = join(root, "config.json");
  const providerPath = join(root, "provider.json");
  await writeFile(
    config,
    JSON.stringify({
      driveMount: join(root, "Drive"),
      stateRoot,
      calendar: {
        managementHorizon: "2026-10-01T00:00:00Z",
        credentials: {
          scheduledRead: join(root, "read.json"),
          interactiveWrite: join(root, "write.json"),
        },
      },
    }),
  );
  await writeFile(
    join(calendarRoot, "owned-calendars.json"),
    JSON.stringify({
      schemaVersion: 1,
      defaultTimezone: "Asia/Singapore",
      managementHorizon: "2026-10-01T00:00:00.000Z",
      ownedCalendarIds: calendarIds,
    }),
  );
  for (const role of roles)
    await writeFile(
      join(calendarRoot, "mirrors", `${role.toLowerCase()}.json`),
      JSON.stringify({
        schemaVersion: 1,
        role,
        calendarId: calendarIds[role],
        managementHorizon: "2026-10-01T00:00:00.000Z",
        lastSuccessfulRefresh: "2026-10-01T00:00:00Z",
        freshness: "fresh",
        syncToken: `${calendarIds[role]}-sync`,
        items: (role === "Academic"
          ? (input.academic ?? [])
          : role === "Routine"
            ? (input.routine ?? [])
            : []
        )
          .filter((item: CalendarEvent) => item.status !== "cancelled")
          .map((item) => ({
            actualCalendarRole: role,
            access: "owned",
            event: item,
          })),
        tombstones:
          role === (input.tombstoneRole ?? "Academic")
            ? (input.tombstones ?? [])
            : [],
      }),
    );
  await writeFile(
    providerPath,
    JSON.stringify({
      strictOccurrences: true,
      calendars: [
        ...roles.map((role) => ({
          id: calendarIds[role],
          summary: role,
          accessRole: "owner",
          selected: true,
          timeZone: "Asia/Singapore",
          etag: `${role}-v1`,
        })),
        {
          id: "observed",
          summary: "Observed",
          accessRole: "reader",
          selected: true,
          timeZone: "Asia/Singapore",
        },
      ],
      events: {
        academic: input.academic ?? [],
        commitments: [],
        routine: input.routine ?? [],
        observed: input.observed ?? [],
      },
      occurrenceEvents: input.occurrences ?? {},
    }),
  );
  return { config, calendarRoot, root, providerPath };
}
async function propose(fixture: Fixture, item: unknown) {
  const path = join(fixture.root, `input-${crypto.randomUUID()}.json`);
  await writeFile(path, JSON.stringify({ schemaVersion: 1, source, item }));
  return await cli(fixture, "propose", "--input", path);
}
async function promote(fixture: Fixture, id: string) {
  return await cli(fixture, "promote", id);
}
async function cli(fixture: Fixture, ...args: string[]) {
  const result = await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_CALENDAR_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${preload}`,
    },
    "calendar",
    ...args,
    "--config",
    fixture.config,
    "--json",
  );
  return { ...result, report: JSON.parse(result.stdout) };
}
async function provider(fixture: Fixture): Promise<ProviderState> {
  return JSON.parse(await readFile(fixture.providerPath, "utf8"));
}
async function mutate(
  fixture: Fixture,
  update: (state: ProviderState) => void,
) {
  const state = await provider(fixture);
  update(state);
  await writeFile(fixture.providerPath, JSON.stringify(state));
}
async function alterProposal(
  fixture: Fixture,
  update: (proposal: CalendarStoredProposal) => void,
) {
  const path = join(fixture.calendarRoot, "pending-proposals.json");
  const state = JSON.parse(await readFile(path, "utf8"));
  update(parseStoredCalendarProposal(state.proposals[0]));
  await writeFile(path, JSON.stringify(state));
}
function writes(state: ProviderState): number {
  return (state.requests ?? []).filter(
    (request: { method: string; url: string }) => request.method !== "GET",
  ).length;
}
function fixed(
  first = "2026-10-20T09:00:00+08:00",
  last = "2026-10-20T10:00:00+08:00",
) {
  return {
    kind: "fixed-event",
    calendarRole: "Academic",
    summary: "Synthetic fixed event",
    start: point(first),
    end: point(last),
  };
}
function change(eventId: string, patch: unknown, recurrenceScope?: string) {
  return {
    operation: "update",
    calendarRole: "Academic",
    eventId,
    patch,
    ...(recurrenceScope === undefined ? {} : { recurrenceScope }),
  };
}
function timetable(
  secondStart: string,
  firstWeeks: NtuWeekSelection = { week: 10 },
) {
  return {
    operation: "academic-timetable",
    calendarRole: "Academic",
    term: "AY2026-27-S1",
    classes: [
      {
        key: "class-a",
        summary: "Synthetic class A",
        weekday: "TU",
        weeks: firstWeeks,
        startTime: "10:00",
        endTime: "11:00",
      },
      {
        key: "class-b",
        summary: "Synthetic class B",
        weekday: "TU",
        weeks: { week: 10 },
        startTime: secondStart,
        endTime:
          secondStart === "10:30"
            ? "11:30"
            : secondStart === "11:00"
              ? "12:00"
              : "13:00",
      },
    ],
    exams: [],
  };
}
