import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
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
  value.classes[0]!.weeks = { from: 10, to: 11 };
  const preview = await propose(fixture, value);
  assert.equal(preview.report.outcome, "ready", JSON.stringify(preview));
  await alterProposal(fixture, (proposal) => {
    proposal.items[1].intendedEvent.start.dateTime =
      "2026-10-20T10:30:00+08:00";
    proposal.items[1].occupiedIntervals = [];
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
      (item: any) => item.interval,
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
    (await provider(fixture)).events.academic[0].start.dateTime,
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
    const original: any = event("deleted");
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
    timetable("11:00"),
    change("series", { summary: "Renamed" }, "entire-series"),
  ]) {
    const fixture = await setup({ academic: [master()] });
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
      .find((request: any) => request.method === "PATCH")
      .url.endsWith("/events/series"),
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
      preview.report.proposal.review.coverage.occurrences.map((item: any) =>
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
    state.calendars.find((calendar: any) => calendar.id === "observed").id =
      "other-observed";
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
    state.calendars[0].timeZone = "UTC";
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
    (await provider(fixture)).events.commitments[0].start.dateTime,
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
      (item: any) => item.id !== "series" && item.recurrence !== undefined,
    ).recurrence,
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

interface Fixture {
  config: string;
  calendarRoot: string;
  root: string;
  providerPath: string;
}
async function setup(
  input: {
    academic?: unknown[];
    observed?: unknown[];
    tombstones?: unknown[];
    occurrences?: Record<string, unknown[]>;
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
        items: (role === "Academic" ? (input.academic ?? []) : [])
          .filter((item: any) => item.status !== "cancelled")
          .map((item) => ({
            actualCalendarRole: role,
            access: "owned",
            event: item,
          })),
        tombstones: role === "Academic" ? (input.tombstones ?? []) : [],
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
          selected: true,
          timeZone: "Asia/Singapore",
          etag: `${role}-v1`,
        })),
        {
          id: "observed",
          summary: "Observed",
          selected: true,
          timeZone: "Asia/Singapore",
        },
      ],
      events: {
        academic: input.academic ?? [],
        commitments: [],
        routine: [],
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
async function provider(fixture: Fixture): Promise<any> {
  return JSON.parse(await readFile(fixture.providerPath, "utf8"));
}
async function mutate(fixture: Fixture, update: (state: any) => void) {
  const state = await provider(fixture);
  update(state);
  await writeFile(fixture.providerPath, JSON.stringify(state));
}
async function alterProposal(
  fixture: Fixture,
  update: (proposal: any) => void,
) {
  const path = join(fixture.calendarRoot, "pending-proposals.json");
  const state = JSON.parse(await readFile(path, "utf8"));
  update(state.proposals[0]);
  await writeFile(path, JSON.stringify(state));
}
function writes(state: any): number {
  return (state.requests ?? []).filter(
    (request: any) => request.method !== "GET",
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
function timetable(secondStart: string) {
  return {
    operation: "academic-timetable",
    calendarRole: "Academic",
    term: "AY2026-27-S1",
    classes: [
      {
        key: "class-a",
        summary: "Synthetic class A",
        weekday: "TU",
        weeks: { week: 10 } as { week: number } | { from: number; to: number },
        startTime: "10:00",
        endTime: "11:00",
      },
      {
        key: "class-b",
        summary: "Synthetic class B",
        weekday: "TU",
        weeks: { week: 10 } as { week: number } | { from: number; to: number },
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
