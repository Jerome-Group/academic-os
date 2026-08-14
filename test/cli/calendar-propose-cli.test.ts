import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runCliWithEnvironment } from "../support/run-cli.js";

const temporaryRoots: string[] = [];
const fakeCalendarPreload = new URL(
  "../support/fake-calendar-preload.js",
  import.meta.url,
).href;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("academic-os calendar propose", () => {
  it("previews one Academic bulk Proposal for classes and exams", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "ntu-timetable", reference: "private-image-1" },
      item: {
        operation: "academic-timetable",
        calendarRole: "Academic",
        term: "AY2026-27-S1",
        classes: [
          {
            key: "mh2500-wednesday", // gitleaks:allow
            summary: "MH2500 TUT SPMS2",
            weekday: "WE",
            startTime: "09:30",
            endTime: "10:20",
            weeks: { from: 2, to: 13 },
            location: "SPMS-TR+5",
          },
          {
            key: "cc0006-monday",
            summary: "CC0006 TUT T004",
            weekday: "MO",
            startTime: "09:30",
            endTime: "11:20",
            location: "COLLAB 2",
          },
        ],
        exams: [
          {
            key: "mh2500-exam",
            summary: "MH2500 exam - Probability",
            date: "2026-11-24",
            startTime: "13:00",
            endTime: "15:00",
          },
        ],
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "ready");
    assert.equal(report.proposal.operation, "bulk-create");
    assert.equal(report.proposal.items.length, 3);
    assert.equal(
      report.proposal.items.find(
        ({ key }: { key: string }) => key === "mh2500-wednesday", // gitleaks:allow
      ).intendedEvent.recurrence[0],
      "RRULE:FREQ=WEEKLY;UNTIL=20261111T155959Z",
    );
    assert.equal(
      report.proposal.items.find(
        ({ key }: { key: string }) => key === "mh2500-exam",
      ).intendedEvent.recurrence,
      undefined,
    );
    assert.equal(report.proposal.conflictSummary.blockers, 0);
    assert.equal(
      (await readProvider(fixture)).requests.some(
        ({ method }) => method !== "GET",
      ),
      false,
    );
  });

  it("prepares a deterministic private fixed-event Proposal with inherited defaults", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "private-request-1" },
      item: {
        kind: "fixed-event",
        calendarRole: "Academic",
        summary: "Topology seminar",
        start: { dateTime: "2026-08-20T10:00:00+08:00" },
        end: { dateTime: "2026-08-20T11:00:00+08:00" },
      },
    });

    const first = await runCalendarPropose(fixture, inputPath, "--json");
    const second = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(first.exitCode, 0, JSON.stringify(first));
    assert.equal(second.exitCode, 0, JSON.stringify(second));
    assert.equal(second.stdout, first.stdout);
    const report = JSON.parse(first.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.command, "calendar propose");
    assert.equal(report.outcome, "ready");
    assert.equal(report.workspace, "written");
    assert.deepEqual(report.proposal.intendedEvent, {
      summary: "Topology seminar",
      visibility: "private",
      transparency: "opaque",
      start: {
        dateTime: "2026-08-20T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T11:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    });
    assert.deepEqual(report.proposal.inheritedDefaults, {
      calendarColorId: "academic-colour",
      reminders: [{ method: "popup", minutes: 30 }],
    });
    assert.deepEqual(report.proposal.targetCalendarVersion, {
      calendarId: "academic-id",
      etag: "academic-version",
    });
    assert.match(report.proposal.id, /^proposal-[a-f0-9]{24}$/u);
    assert.match(report.proposal.idempotencyKey, /^create-[a-f0-9]{64}$/u);
    assert.deepEqual(
      report.proposal.liveVersions.map(
        ({ calendarRole, syncToken }: Record<string, string>) => ({
          calendarRole,
          syncToken,
        }),
      ),
      [
        { calendarRole: "Academic", syncToken: "academic-sync" },
        { calendarRole: "Commitments", syncToken: "commitments-sync" },
        { calendarRole: "Routine", syncToken: "routine-sync" },
      ],
    );
    assert.deepEqual(report.conflicts, []);
    assert.deepEqual(report.warnings, []);

    const persisted = await readProposalState(fixture);
    assert.deepEqual(persisted.proposals, [report.proposal]);
    const provider = await readProvider(fixture);
    assert.ok(provider.requests.length > 0);
    assert.ok(provider.requests.every(({ method }) => method === "GET"));
  });

  it("warns for Routine overlaps, uses only an explicit travel buffer, and never persists Observed details", async () => {
    const fixture = await setupFixture({
      observedEvents: [
        {
          id: "sensitive-observed-id",
          summary: "Sensitive observed title",
          start: { dateTime: "2026-08-20T09:50:00+08:00" },
          end: { dateTime: "2026-08-20T10:10:00+08:00" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "private-request-2" },
      item: {
        kind: "routine-event",
        calendarRole: "Routine",
        summary: "Morning walk",
        start: {
          dateTime: "2026-08-20T10:15:00+08:00",
          timeZone: "Asia/Kuala_Lumpur",
        },
        end: {
          dateTime: "2026-08-20T10:45:00+08:00",
          timeZone: "Asia/Kuala_Lumpur",
        },
        travelBuffer: { beforeMinutes: 10, afterMinutes: 5 },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "ready");
    assert.equal(report.proposal.intendedEvent.transparency, "transparent");
    assert.equal(
      report.proposal.intendedEvent.start.timeZone,
      "Asia/Kuala_Lumpur",
    );
    assert.equal(report.conflicts.length, 0);
    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].source, "Observed");
    assert.equal(report.warnings[0].eventId, "sensitive-observed-id");

    const provider = await readProvider(fixture);
    const eventRequests = provider.requests.filter(({ url }) =>
      url.includes("/events"),
    );
    assert.ok(eventRequests.length > 0);
    assert.ok(
      eventRequests.every(
        ({ params }) =>
          params.timeMin === "2026-08-20T02:05:00.000Z" &&
          params.timeMax === "2026-08-20T02:50:00.000Z",
      ),
    );
    const persisted = JSON.stringify(await readProposalState(fixture));
    assert.doesNotMatch(persisted, /Sensitive observed title/u);
    assert.doesNotMatch(persisted, /sensitive-observed-id/u);
  });

  it("blocks a fixed event across Owned and selected Observed calendars without writing Proposal state", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "existing-class",
          summary: "Existing class",
          start: { dateTime: "2026-08-20T10:30:00+08:00" },
          end: { dateTime: "2026-08-20T11:30:00+08:00" },
        },
        {
          id: "weekly-class",
          summary: "Weekly class",
          recurrence: ["RRULE:FREQ=WEEKLY"],
          start: { dateTime: "2026-08-06T09:00:00+08:00" },
          end: { dateTime: "2026-08-06T10:00:00+08:00" },
        },
      ],
      providerAcademicEvents: [
        {
          id: "weekly-class-20260820",
          recurringEventId: "weekly-class",
          summary: "Weekly class",
          start: { dateTime: "2026-08-20T11:30:00+08:00" },
          end: { dateTime: "2026-08-20T12:30:00+08:00" },
        },
        {
          id: "unrefreshed-live-only",
          summary: "Not in the current mirror",
          start: { dateTime: "2026-08-20T11:00:00+08:00" },
          end: { dateTime: "2026-08-20T12:00:00+08:00" },
        },
      ],
      observedEvents: [
        {
          id: "observed-commitment",
          summary: "Shared commitment",
          transparency: "transparent",
          start: { dateTime: "2026-08-20T11:15:00+08:00" },
          end: { dateTime: "2026-08-20T11:45:00+08:00" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "private-request-3" },
      item: {
        kind: "fixed-event",
        calendarRole: "Commitments",
        summary: "Dentist",
        start: { dateTime: "2026-08-20T11:00:00+08:00" },
        end: { dateTime: "2026-08-20T12:00:00+08:00" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "blocked");
    assert.equal(report.proposal.status, undefined);
    assert.equal(report.workspace, "not-written");
    assert.deepEqual(
      report.conflicts.map(
        ({ eventId, source }: { eventId: string; source: string }) => ({
          eventId,
          source,
        }),
      ),
      [
        { eventId: "existing-class", source: "Owned" },
        { eventId: "weekly-class-20260820", source: "Owned" },
        { eventId: "observed-commitment", source: "Observed" },
      ],
    );
    const eventRequests = (await readProvider(fixture)).requests.filter(
      ({ url }) => url.includes("/events"),
    );
    assert.deepEqual(
      eventRequests.map(({ url }) =>
        url.includes("academic-id") ? "Academic" : "Observed",
      ),
      ["Academic", "Observed"],
    );
    assert.ok(
      eventRequests.every(
        ({ params }) =>
          params.timeMin === "2026-08-20T03:00:00.000Z" &&
          params.timeMax === "2026-08-20T04:00:00.000Z",
      ),
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("previews valid transparent milestones with zero conflict intervals and equivalent human output", async () => {
    const fixture = await setupFixture();
    const timedInput = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "document", reference: "private-notice-1" },
      item: {
        kind: "timed-milestone",
        calendarRole: "Academic",
        summary: "Submission closes",
        at: {
          dateTime: "2026-08-20T23:59:00+08:00",
          timeZone: "Asia/Singapore",
        },
      },
    });
    const allDayInput = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "document", reference: "private-notice-2" },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        summary: "Results released",
        date: "2026-08-30",
      },
    });

    const timed = await runCalendarPropose(fixture, timedInput, "--json");
    const allDayJson = await runCalendarPropose(fixture, allDayInput, "--json");
    const allDayHuman = await runCalendarPropose(fixture, allDayInput);

    assert.equal(timed.exitCode, 0, JSON.stringify(timed));
    assert.deepEqual(JSON.parse(timed.stdout).proposal.intendedEvent, {
      summary: "Submission closes",
      visibility: "private",
      transparency: "transparent",
      start: {
        dateTime: "2026-08-20T23:59:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T16:00:00.000Z",
        timeZone: "Asia/Singapore",
      },
    });
    const allDayReport = JSON.parse(allDayJson.stdout);
    assert.deepEqual(allDayReport.proposal.intendedEvent, {
      summary: "Results released",
      visibility: "private",
      transparency: "transparent",
      start: { date: "2026-08-30" },
      end: { date: "2026-08-31" },
    });
    assert.doesNotMatch(
      JSON.stringify(allDayReport.proposal.intendedEvent),
      /timeZone/u,
    );
    assert.equal(allDayReport.conflicts.length, 0);
    assert.equal(allDayReport.warnings.length, 0);
    assert.equal(allDayHuman.exitCode, 0, JSON.stringify(allDayHuman));
    assert.deepEqual(parseHumanReport(allDayHuman.stdout), allDayReport);
    const provider = await readProvider(fixture);
    assert.ok(provider.requests.every(({ method }) => method === "GET"));
  });

  it("previews an exact update patch without provider mutation", async () => {
    const existing = {
      id: "owned-seminar",
      etag: "event-version-1",
      summary: "Old title",
      description: "Keep this description",
      attendees: [{ email: "guest@example.com" }],
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 5 }],
      },
      start: {
        dateTime: "2026-08-20T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T11:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const fixture = await setupFixture({ academicEvents: [existing] });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "rename-owned-seminar" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "owned-seminar",
        patch: { summary: "New title" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.proposal.operation, "update");
    assert.deepEqual(report.proposal.patch, { summary: "New title" });
    assert.deepEqual(report.proposal.sourceItem, {
      calendarRole: "Academic",
      calendarId: "academic-id",
      eventId: "owned-seminar",
      versionDigest: report.proposal.sourceItem.versionDigest,
    });
    assert.match(report.proposal.sourceItem.versionDigest, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(
      JSON.stringify(report.proposal.patch),
      /description|attendees|reminders/u,
    );
    assert.ok(
      ((await readProvider(fixture)).requests ?? []).every(
        ({ method }) => method === "GET",
      ),
    );
  });

  it("requires and preserves each explicit recurring edit scope", async () => {
    const recurringMaster = {
      id: "weekly-class",
      summary: "Weekly class",
      recurrence: ["RRULE:FREQ=WEEKLY"],
      start: {
        dateTime: "2026-08-20T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T11:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    for (const recurrenceScope of [
      "this-occurrence",
      "entire-series",
      "this-and-future",
    ]) {
      const recurringTarget =
        recurrenceScope === "entire-series"
          ? recurringMaster
          : {
              ...recurringMaster,
              id: `weekly-class-${recurrenceScope}`,
              recurrence: undefined,
              recurringEventId: "weekly-class",
              originalStartTime: recurringMaster.start,
            };
      const fixture = await setupFixture({
        academicEvents:
          recurrenceScope === "this-and-future"
            ? [recurringMaster, recurringTarget]
            : [recurringTarget],
      });
      const inputPath = await writeInput(fixture, {
        schemaVersion: 1,
        source: { kind: "instruction", reference: recurrenceScope },
        item: {
          operation: "update",
          calendarRole: "Academic",
          eventId: recurringTarget.id,
          recurrenceScope,
          patch: { summary: `Changed ${recurrenceScope}` },
        },
      });
      const result = await runCalendarPropose(fixture, inputPath, "--json");
      assert.equal(result.exitCode, 0, JSON.stringify(result));
      assert.equal(
        JSON.parse(result.stdout).proposal.recurrenceScope,
        recurrenceScope,
      );
    }

    const fixture = await setupFixture({ academicEvents: [recurringMaster] });
    const missingScope = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "missing-scope" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "weekly-class",
        patch: { summary: "Ambiguous change" },
      },
    });
    const rejected = await runCalendarPropose(fixture, missingScope, "--json");
    assert.equal(rejected.exitCode, 2, JSON.stringify(rejected));
    assert.match(rejected.stdout, /require exactly one recurrenceScope/u);
  });

  it("prepares this-and-future for an all-day recurring occurrence", async () => {
    const master = {
      id: "annual-day",
      summary: "Annual day",
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=3"],
      start: { date: "2026-08-20" },
      end: { date: "2026-08-21" },
    };
    const occurrence = {
      id: "annual-day-2027",
      recurringEventId: "annual-day",
      originalStartTime: { date: "2027-08-20" },
      summary: "Annual day",
      start: { date: "2027-08-20" },
      end: { date: "2027-08-21" },
    };
    const fixture = await setupFixture({
      academicEvents: [master, occurrence],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "all-day-future" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: occurrence.id,
        recurrenceScope: "this-and-future",
        patch: { summary: "Changed annual day" },
      },
    });
    const result = await runCalendarPropose(fixture, inputPath, "--json");
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(
      JSON.parse(result.stdout).proposal.recurrenceScope,
      "this-and-future",
    );
  });

  it("rejects writes to invited events", async () => {
    const invited = {
      id: "invited-talk",
      summary: "Invited talk",
      organizer: { email: "organiser@example.com", self: false },
      start: { dateTime: "2026-08-20T10:00:00+08:00" },
      end: { dateTime: "2026-08-20T11:00:00+08:00" },
    };
    const fixture = await setupFixture({ academicEvents: [invited] });
    const mirrorPath = join(fixture.calendarRoot, "mirrors", "academic.json");
    const mirror = JSON.parse(await readFile(mirrorPath, "utf8"));
    mirror.items[0].access = "invited-read-only";
    await writeFile(mirrorPath, `${JSON.stringify(mirror)}\n`);
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "edit-invitation" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "invited-talk",
        patch: { summary: "Forbidden" },
      },
    });
    const result = await runCalendarPropose(fixture, inputPath, "--json");
    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(result.stdout, /Invited events are read-only/u);
    assert.ok(
      ((await readProvider(fixture)).requests ?? []).every(
        ({ method }) => method === "GET",
      ),
    );
  });

  it("previews exact cancellation scopes and explicit tombstone restoration", async () => {
    const recurring = {
      id: "weekly-class-instance",
      recurringEventId: "weekly-class",
      summary: "Weekly class",
      originalStartTime: { dateTime: "2026-08-20T10:00:00+08:00" },
      start: { dateTime: "2026-08-20T10:00:00+08:00" },
      end: { dateTime: "2026-08-20T11:00:00+08:00" },
    };
    const fixture = await setupFixture({ academicEvents: [recurring] });
    const cancelPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "cancel-class" },
      item: {
        operation: "cancel",
        calendarRole: "Academic",
        eventId: recurring.id,
        recurrenceScope: "this-occurrence",
      },
    });

    const cancelled = await runCalendarPropose(fixture, cancelPath, "--json");
    assert.equal(cancelled.exitCode, 0, JSON.stringify(cancelled));
    const cancelProposal = JSON.parse(cancelled.stdout).proposal;
    assert.equal(cancelProposal.operation, "cancel");
    assert.equal(cancelProposal.recurrenceScope, "this-occurrence");
    assert.deepEqual(cancelProposal.preview.event, recurring);

    const mirrorPath = join(fixture.calendarRoot, "mirrors", "academic.json");
    const mirror = JSON.parse(await readFile(mirrorPath, "utf8"));
    mirror.items = [];
    mirror.tombstones = [
      {
        access: "owned",
        deletedAt: "2026-08-20T12:00:00.000Z",
        event: recurring,
      },
    ];
    await writeFile(mirrorPath, `${JSON.stringify(mirror)}\n`);
    const restorePath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "restore-class" },
      item: {
        operation: "restore",
        calendarRole: "Academic",
        eventId: recurring.id,
      },
    });
    const restored = await runCalendarPropose(fixture, restorePath, "--json");
    assert.equal(restored.exitCode, 0, JSON.stringify(restored));
    const restoreProposal = JSON.parse(restored.stdout).proposal;
    assert.equal(restoreProposal.operation, "restore");
    assert.equal(restoreProposal.restoredFrom.eventId, recurring.id);
    assert.notEqual(
      restoreProposal.idempotencyKey,
      cancelProposal.idempotencyKey,
    );
    assert.ok(
      ((await readProvider(fixture)).requests ?? []).every(
        ({ method }) => method === "GET",
      ),
    );
  });

  it("rejects restoration of retained invited tombstones", async () => {
    const fixture = await setupFixture();
    const mirrorPath = join(fixture.calendarRoot, "mirrors", "academic.json");
    const mirror = JSON.parse(await readFile(mirrorPath, "utf8"));
    mirror.tombstones = [
      {
        access: "invited-read-only",
        deletedAt: "2026-08-20T12:00:00.000Z",
        event: { id: "invited-deleted", summary: "Invited talk" },
      },
    ];
    await writeFile(mirrorPath, `${JSON.stringify(mirror)}\n`);
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "restore-invited" },
      item: {
        operation: "restore",
        calendarRole: "Academic",
        eventId: "invited-deleted",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(result.stdout, /Invited events cannot be restored/u);
  });

  it("turns an explicit placement correction into a move Proposal only", async () => {
    const misplaced = {
      id: "misplaced-routine",
      summary: "Sleep",
      transparency: "transparent",
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { dateTime: "2026-08-20T23:00:00+08:00" },
      end: { dateTime: "2026-08-21T07:00:00+08:00" },
    };
    const fixture = await setupFixture({ academicEvents: [misplaced] });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "placement-suggestion", reference: "misplaced-routine" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        targetCalendarRole: "Routine",
        eventId: "misplaced-routine",
        recurrenceScope: "entire-series",
        patch: {},
      },
    });
    const result = await runCalendarPropose(fixture, inputPath, "--json");
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const proposal = JSON.parse(result.stdout).proposal;
    assert.equal(proposal.operation, "move");
    assert.deepEqual(proposal.target, {
      calendarRole: "Routine",
      calendarId: "routine-id",
    });
    assert.deepEqual(proposal.patch, {});
    assert.ok(
      ((await readProvider(fixture)).requests ?? []).every(
        ({ method }) => method === "GET",
      ),
    );
  });

  it("blocks a time-changing update against current bounded availability", async () => {
    const existing = {
      id: "owned-meeting",
      summary: "Meeting",
      start: {
        dateTime: "2026-08-20T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T11:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const fixture = await setupFixture({
      academicEvents: [existing],
      observedEvents: [
        {
          id: "new-time-conflict",
          summary: "Shared commitment",
          start: { dateTime: "2026-08-20T12:30:00+08:00" },
          end: { dateTime: "2026-08-20T13:30:00+08:00" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "move-meeting-time" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "owned-meeting",
        patch: {
          start: {
            dateTime: "2026-08-20T12:00:00+08:00",
            timeZone: "Asia/Singapore",
          },
          end: {
            dateTime: "2026-08-20T13:00:00+08:00",
            timeZone: "Asia/Singapore",
          },
        },
      },
    });
    const result = await runCalendarPropose(fixture, inputPath, "--json");
    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(
      JSON.parse(result.stdout).conflicts[0].eventId,
      "new-time-conflict",
    );
  });

  it("previews one exact-ID Routine migration with decisions and no provider mutation", async () => {
    const sleep = {
      id: "sleep-series",
      summary: "Sleep",
      recurrence: ["RRULE:FREQ=DAILY"],
      transparency: "opaque",
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 5 }],
      },
      start: {
        dateTime: "2026-07-20T23:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-07-21T07:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const sleepException = {
      id: "sleep-exception",
      recurringEventId: "sleep-series",
      originalStartTime: {
        dateTime: "2026-08-20T23:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      summary: "Sleep",
      start: {
        dateTime: "2026-08-21T00:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-21T08:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const exercise = {
      id: "exercise-series",
      summary: "Exercise",
      recurrence: ["RRULE:FREQ=WEEKLY"],
      transparency: "transparent",
      start: {
        dateTime: "2026-08-21T18:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-21T19:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const unreviewed = {
      id: "unreviewed-series",
      summary: "Weekly class",
      recurrence: ["RRULE:FREQ=WEEKLY"],
      start: {
        dateTime: "2026-08-22T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-22T11:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const fixture = await setupFixture({
      academicEvents: [sleep, sleepException, exercise, unreviewed],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "routine-migration", reference: "reviewed-2026-08" },
      item: {
        operation: "routine-migration",
        reviewedSeries: [
          {
            providerIdentity: {
              calendarRole: "Academic",
              calendarId: "academic-id",
              eventId: "sleep-series",
            },
            label: "sleep",
          },
          {
            providerIdentity: {
              calendarRole: "Academic",
              calendarId: "academic-id",
              eventId: "exercise-series",
            },
            label: "exercise",
          },
          {
            providerIdentity: {
              calendarRole: "Academic",
              calendarId: "academic-id",
              eventId: "missing-series",
            },
            label: "shower",
          },
        ],
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "ready");
    assert.deepEqual(
      report.proposal.moves.map(
        ({ sourceItem }: { sourceItem: { eventId: string } }) =>
          sourceItem.eventId,
      ),
      ["sleep-series", "exercise-series"],
    );
    assert.deepEqual(report.proposal.moves[0].seriesEventIds, [
      "sleep-series",
      "sleep-exception",
    ]);
    assert.deepEqual(report.proposal.moves[0].patch, {
      transparency: "transparent",
    });
    assert.deepEqual(report.proposal.moves[1].patch, {});
    assert.ok(
      report.proposal.decisions.some(
        ({
          providerIdentity,
          reason,
        }: {
          providerIdentity: { eventId: string };
          reason: string;
        }) =>
          providerIdentity.eventId === "missing-series" &&
          reason === "provider-identity-not-found",
      ),
    );
    assert.ok(
      report.proposal.decisions.some(
        ({
          providerIdentity,
          reason,
        }: {
          providerIdentity: { eventId: string };
          reason: string;
        }) =>
          providerIdentity.eventId === "unreviewed-series" &&
          reason === "unreviewed-recurring-series",
      ),
    );
    assert.equal(
      ((await readProvider(fixture)).requests ?? []).filter(
        ({ method }) => method !== "GET",
      ).length,
      0,
    );
    assert.equal((await readProposalState(fixture)).proposals.length, 1);
  });

  it("does not mark a Routine master complete while an Academic exception remains", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "partial-exception",
          recurringEventId: "partial-series",
          originalStartTime: {
            dateTime: "2026-08-22T08:00:00+08:00",
            timeZone: "Asia/Singapore",
          },
          start: { dateTime: "2026-08-22T09:00:00+08:00" },
          end: { dateTime: "2026-08-22T10:00:00+08:00" },
        },
      ],
      routineEvents: [
        {
          id: "partial-series",
          summary: "Exercise",
          recurrence: ["RRULE:FREQ=WEEKLY"],
          transparency: "transparent",
          start: { dateTime: "2026-08-22T08:00:00+08:00" },
          end: { dateTime: "2026-08-22T09:00:00+08:00" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "routine-migration", reference: "reviewed-2026-08" },
      item: {
        operation: "routine-migration",
        reviewedSeries: [
          {
            providerIdentity: {
              calendarRole: "Academic",
              calendarId: "academic-id",
              eventId: "partial-series",
            },
          },
        ],
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const proposal = JSON.parse(result.stdout).proposal;
    assert.deepEqual(proposal.moves, []);
    assert.deepEqual(proposal.completed, []);
    assert.equal(proposal.decisions[0].reason, "partial-recurring-series");
  });
});

interface Fixture {
  calendarRoot: string;
  configPath: string;
  inputRoot: string;
  providerPath: string;
  readCredential: string;
}

async function setupFixture(
  input: {
    academicEvents?: unknown[];
    observedEvents?: unknown[];
    providerAcademicEvents?: unknown[];
    routineEvents?: unknown[];
  } = {},
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-calendar-propose-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const calendarRoot = join(stateRoot, "calendar");
  const mirrorsRoot = join(calendarRoot, "mirrors");
  const inputRoot = join(root, "Inputs");
  await Promise.all([
    mkdir(driveMount),
    mkdir(mirrorsRoot, { recursive: true }),
    mkdir(inputRoot),
  ]);
  const configPath = join(root, "academic-os.config.json");
  const readCredential = join(root, "calendar-read.credentials.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      driveMount,
      stateRoot,
      calendar: {
        managementHorizon: "2026-08-01T08:00:00+08:00",
        credentials: {
          scheduledRead: readCredential,
          interactiveWrite: join(root, "calendar-write.credentials.json"),
        },
      },
    })}\n`,
  );
  await writeFile(
    join(calendarRoot, "owned-calendars.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      defaultTimezone: "Asia/Singapore",
      managementHorizon: "2026-08-01T00:00:00.000Z",
      ownedCalendarIds: {
        Academic: "academic-id",
        Commitments: "commitments-id",
        Routine: "routine-id",
      },
    })}\n`,
  );
  const eventsByRole = {
    Academic: input.academicEvents ?? [],
    Commitments: [],
    Routine: input.routineEvents ?? [],
  };
  for (const [role, calendarId, syncToken] of [
    ["Academic", "academic-id", "academic-sync"],
    ["Commitments", "commitments-id", "commitments-sync"],
    ["Routine", "routine-id", "routine-sync"],
  ] as const) {
    await writeFile(
      join(mirrorsRoot, `${role.toLowerCase()}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        role,
        calendarId,
        managementHorizon: "2026-08-01T00:00:00.000Z",
        lastSuccessfulRefresh: "2026-08-19T21:00:00.000Z",
        freshness: "fresh",
        syncToken,
        items: eventsByRole[role].map((event) => ({
          actualCalendarRole: role,
          access: "owned",
          event,
        })),
        tombstones: [],
      })}\n`,
    );
  }
  const providerPath = join(root, "provider.json");
  await writeFile(
    providerPath,
    `${JSON.stringify({
      calendars: [
        {
          id: "academic-id",
          summary: "Personal",
          primary: true,
          selected: true,
          colorId: "academic-colour",
          etag: "academic-version",
          defaultReminders: [{ method: "popup", minutes: 30 }],
        },
        {
          id: "commitments-id",
          summary: "Commitments",
          selected: true,
          colorId: "commitments-colour",
          etag: "commitments-version",
          defaultReminders: [{ method: "email", minutes: 60 }],
        },
        {
          id: "routine-id",
          summary: "Routine",
          selected: true,
          colorId: "routine-colour",
          etag: "routine-version",
          defaultReminders: [],
        },
        {
          id: "observed-id",
          summary: "Observed",
          selected: true,
          colorId: "observed-colour",
        },
        {
          id: "hidden-id",
          summary: "Hidden",
          selected: true,
          hidden: true,
        },
      ],
      events: {
        "academic-id":
          input.providerAcademicEvents ?? input.academicEvents ?? [],
        "commitments-id": [],
        "routine-id": input.routineEvents ?? [],
        "observed-id": input.observedEvents ?? [],
        "hidden-id": [
          {
            id: "ignored-hidden-conflict",
            start: { dateTime: "2026-08-20T10:00:00+08:00" },
            end: { dateTime: "2026-08-20T11:00:00+08:00" },
          },
        ],
      },
    })}\n`,
  );
  return { calendarRoot, configPath, inputRoot, providerPath, readCredential };
}

async function writeInput(fixture: Fixture, value: unknown): Promise<string> {
  const path = join(fixture.inputRoot, `proposal-${crypto.randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify(value)}\n`);
  return path;
}

async function runCalendarPropose(
  fixture: Fixture,
  inputPath: string,
  ...arguments_: string[]
) {
  return await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_CALENDAR_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${fakeCalendarPreload}`,
    },
    "calendar",
    "propose",
    "--config",
    fixture.configPath,
    "--input",
    inputPath,
    ...arguments_,
  );
}

async function readProposalState(fixture: Fixture): Promise<{
  proposals: unknown[];
}> {
  return JSON.parse(
    await readFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      "utf8",
    ),
  );
}

async function readProvider(fixture: Fixture): Promise<{
  requests: Array<{
    method: string;
    params: Record<string, string>;
    url: string;
  }>;
}> {
  return JSON.parse(await readFile(fixture.providerPath, "utf8"));
}

function parseHumanReport(stdout: string): unknown {
  const lines = stdout.trimEnd().split("\n");
  const outcome = lines[0]?.replace("Calendar propose: ", "");
  const proposal = JSON.parse(lines[1]?.replace("Proposal: ", "") ?? "null");
  const conflicts = JSON.parse(lines[2]?.replace("Conflicts: ", "") ?? "null");
  const warnings = JSON.parse(lines[3]?.replace("Warnings: ", "") ?? "null");
  const workspace = lines[4]?.replace("Workspace: ", "").replace(" ", "-");
  return {
    schemaVersion: 1,
    command: "calendar propose",
    outcome,
    proposal,
    conflicts,
    warnings,
    workspace,
  };
}
