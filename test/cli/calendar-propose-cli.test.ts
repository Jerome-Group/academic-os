import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { recordResearchBehaviorEvidence } from "../support/rule-evidence.js";
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

  it("preserves an explicit recurrence for a Routine-event Proposal", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "weekday-lunch-series" },
      item: {
        kind: "routine-event",
        calendarRole: "Routine",
        summary: "Lunch",
        start: {
          dateTime: "2026-05-12T12:30:00+08:00",
          timeZone: "Asia/Singapore",
        },
        end: {
          dateTime: "2026-05-12T13:30:00+08:00",
          timeZone: "Asia/Singapore",
        },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.stdout).proposal.intendedEvent, {
      summary: "Lunch",
      visibility: "private",
      transparency: "transparent",
      start: {
        dateTime: "2026-05-12T12:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-05-12T13:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
    });
  });

  it("does not count a recurring master's own occurrences as conflicts", async () => {
    const recurringMaster = {
      id: "lunch-master",
      summary: "Lunch",
      recurrence: ["RRULE:FREQ=DAILY"],
      start: {
        dateTime: "2026-08-20T12:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T13:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      transparency: "transparent",
    };
    const occurrence = {
      id: "lunch-master_20260821T043000Z",
      recurringEventId: "lunch-master",
      summary: "Lunch",
      originalStartTime: {
        dateTime: "2026-08-21T12:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      start: {
        dateTime: "2026-08-21T12:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-21T13:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      transparency: "transparent",
    };
    const fixture = await setupFixture({
      academicEvents: [recurringMaster],
      providerAcademicEvents: [recurringMaster, occurrence],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "round-recurring-master" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "lunch-master",
        recurrenceScope: "entire-series",
        patch: {
          end: {
            dateTime: "2026-08-20T13:30:00+08:00",
            timeZone: "Asia/Singapore",
          },
        },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).conflicts.length, 0);
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

  it("rejects an under-specified provisional research milestone", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        evidenceStatus: "provisional",
        summary: "URECA abstract planning window closes — provisional",
        description:
          "Planning marker from standing public guidance; verify the AY2026-27 deadline in the Student Intranet before relying on it.",
        date: "2027-02-28",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /provisional research milestone summary must say "Provisional"/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("keeps compliant provisional research evidence and provenance", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        evidenceStatus: "provisional",
        summary: "URECA abstract planning marker — Provisional",
        description:
          "Provisional planning marker. Standing source: NTU URECA current-student guidance says end-February. Verification Task: Confirm the AY2026-27 abstract date in the Student Intranet.",
        date: "2027-02-28",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const proposal = JSON.parse(result.stdout).proposal;
    assert.deepEqual(proposal.source, {
      kind: "research-project",
      reference: "ureca-y2/standing-window/end-feb",
    });
    assert.deepEqual(proposal.intendedEvent, {
      summary: "URECA abstract planning marker — Provisional",
      description:
        "Provisional planning marker. Standing source: NTU URECA current-student guidance says end-February. Verification Task: Confirm the AY2026-27 abstract date in the Student Intranet.",
      visibility: "private",
      transparency: "transparent",
      start: { date: "2027-02-28" },
      end: { date: "2027-03-01" },
    });
  });

  it("requires provisional research milestones to cite evidence and a verification Task", async () => {
    const fixture = await setupFixture();
    const cases = [
      {
        description:
          "Provisional planning marker. Verification Task: Confirm the current date.",
        error: /must cite "Standing source:"/u,
      },
      {
        description:
          "Provisional planning marker. Standing source: current programme guidance.",
        error: /must point to "Verification Task:"/u,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const inputPath = await writeInput(fixture, {
        schemaVersion: 1,
        source: {
          kind: "research-project",
          reference: `ureca-y2/standing-window/${index.toString()}`,
        },
        item: {
          kind: "timed-milestone",
          calendarRole: "Academic",
          evidenceStatus: "provisional",
          summary: "Research planning marker — Provisional",
          description: testCase.description,
          at: { dateTime: "2027-02-28T09:00:00+08:00" },
        },
      });

      const result = await runCalendarPropose(fixture, inputPath, "--json");

      assert.equal(result.exitCode, 2, JSON.stringify(result));
      assert.match(JSON.parse(result.stdout).error.message, testCase.error);
    }
    await assert.rejects(readProposalState(fixture));
  });

  it("does not turn a standing window into a confirmed research deadline", async () => {
    const fixture = await setupFixture();
    const unmarkedInput = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-mar",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        evidenceStatus: "provisional",
        summary: "URECA poster submission",
        description: "Programme guidance says end-March.",
        date: "2027-03-31",
      },
    });
    const deadlineInput = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-mar",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        evidenceStatus: "provisional",
        summary: "URECA poster deadline — Provisional",
        description:
          "Provisional marker. Standing source: programme guidance says end-March. Verification Task: Confirm the current exact date.",
        date: "2027-03-31",
      },
    });
    const deadlinesInput = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-mar",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        evidenceStatus: "provisional",
        summary: "URECA poster deadlines — Provisional",
        description:
          "Provisional marker. Standing source: programme guidance says end-March. Verification Task: Confirm the current exact date.",
        date: "2027-03-31",
      },
    });

    const unmarked = await runCalendarPropose(fixture, unmarkedInput, "--json");
    const deadline = await runCalendarPropose(fixture, deadlineInput, "--json");
    const deadlines = await runCalendarPropose(
      fixture,
      deadlinesInput,
      "--json",
    );

    assert.equal(unmarked.exitCode, 2, JSON.stringify(unmarked));
    assert.match(
      JSON.parse(unmarked.stdout).error.message,
      /summary must say "Provisional"/u,
    );
    assert.equal(deadline.exitCode, 2, JSON.stringify(deadline));
    assert.match(
      JSON.parse(deadline.stdout).error.message,
      /must not be called a deadline/u,
    );
    assert.equal(deadlines.exitCode, 2, JSON.stringify(deadlines));
    assert.match(
      JSON.parse(deadlines.stdout).error.message,
      /must not be called a deadline/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("requires explicit evidence status for every research milestone", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/current-students",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        summary: "URECA paper deadline",
        description: "Public current-student guidance says end-June.",
        date: "2027-06-30",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /requires item\.evidenceStatus confirmed or provisional/u,
    );
    await assert.rejects(readProposalState(fixture));
    recordResearchBehaviorEvidence("RP-CALENDAR-001", () => {
      assert.equal(result.exitCode, 2);
      assert.match(
        JSON.parse(result.stdout).error.message,
        /requires item\.evidenceStatus confirmed or provisional/u,
      );
    });
  });

  it("requires a confirmed research milestone to say Confirmed", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/authenticated/abstract-date",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        evidenceStatus: "confirmed",
        summary: "URECA abstract deadline",
        description:
          "Confirmed source: authenticated AY2026-27 URECA notice captured in the private project evidence.",
        date: "2027-02-23",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /confirmed research milestone summary must say "Confirmed"/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("accepts a confirmed research deadline only with confirmed evidence", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/authenticated/abstract-date",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        evidenceStatus: "confirmed",
        summary: "URECA abstract deadline — Confirmed",
        description:
          "Confirmed source: authenticated AY2026-27 URECA notice captured in the private project evidence.",
        date: "2027-02-23",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.stdout).proposal.source, {
      kind: "research-project",
      reference: "ureca-y2/authenticated/abstract-date",
    });
  });

  it("does not let a manual create manufacture a confirmed research signature", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "standing-guidance" },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        summary: "Programme abstract date — Confirmed",
        description: "Confirmed source: standing guidance.",
        date: "2027-02-23",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("keeps partial confirmed wording available to generic milestone creates", async () => {
    const citationFixture = await setupFixture();
    const citationInput = await writeInput(citationFixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "club-committee-email" },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        summary: "Submit club form",
        description: "Confirmed source: club committee email.",
        date: "2027-02-23",
      },
    });
    const labelFixture = await setupFixture();
    const labelInput = await writeInput(labelFixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "club-form-check" },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        summary: "Submit club form — Confirmed",
        description: "Personal reminder.",
        date: "2027-02-23",
      },
    });

    const citationResult = await runCalendarPropose(
      citationFixture,
      citationInput,
      "--json",
    );
    const labelResult = await runCalendarPropose(
      labelFixture,
      labelInput,
      "--json",
    );

    assert.equal(citationResult.exitCode, 0, JSON.stringify(citationResult));
    assert.equal(labelResult.exitCode, 0, JSON.stringify(labelResult));
  });

  it("requires a new research milestone to target Academic", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/authenticated/abstract-date",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Commitments",
        evidenceStatus: "confirmed",
        summary: "URECA abstract deadline — Confirmed",
        description:
          "Confirmed source: authenticated AY2026-27 URECA notice captured in the private project evidence.",
        date: "2027-02-23",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /research-project marker must remain an Academic private transparent milestone/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not use research-project provenance for a fixed event", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/supervisor-meeting",
      },
      item: {
        kind: "fixed-event",
        calendarRole: "Academic",
        summary: "Supervisor meeting",
        start: { dateTime: "2027-02-23T10:00:00+08:00" },
        end: { dateTime: "2027-02-23T11:00:00+08:00" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /research-project marker must remain an Academic private transparent milestone/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not use research-project provenance for a routine event", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/reading-session",
      },
      item: {
        kind: "routine-event",
        calendarRole: "Routine",
        summary: "Research reading",
        start: { dateTime: "2027-02-23T10:00:00+08:00" },
        end: { dateTime: "2027-02-23T11:00:00+08:00" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /research-project marker must remain an Academic private transparent milestone/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not reclassify an event through research-project update provenance", async () => {
    for (const [calendarRole, events] of [
      [
        "Academic",
        [
          {
            id: "supervisor-meeting",
            summary: "Supervisor meeting",
            visibility: "private",
            transparency: "opaque",
            start: {
              dateTime: "2027-02-23T10:00:00+08:00",
              timeZone: "Asia/Singapore",
            },
            end: {
              dateTime: "2027-02-23T11:00:00+08:00",
              timeZone: "Asia/Singapore",
            },
          },
        ],
      ],
      [
        "Routine",
        [
          {
            id: "research-reading",
            summary: "Research reading",
            visibility: "private",
            transparency: "transparent",
            start: {
              dateTime: "2027-02-23T10:00:00+08:00",
              timeZone: "Asia/Singapore",
            },
            end: {
              dateTime: "2027-02-23T11:00:00+08:00",
              timeZone: "Asia/Singapore",
            },
          },
        ],
      ],
    ] as const) {
      const fixture = await setupFixture({
        ...(calendarRole === "Academic"
          ? { academicEvents: [...events] }
          : { routineEvents: [...events] }),
      });
      const inputPath = await writeInput(fixture, {
        schemaVersion: 1,
        source: { kind: "research-project", reference: "ureca-y2/edit" },
        item: {
          operation: "update",
          calendarRole,
          eventId: events[0].id,
          patch: { summary: `${events[0].summary} updated` },
        },
      });

      const result = await runCalendarPropose(fixture, inputPath, "--json");

      assert.equal(result.exitCode, 2, JSON.stringify(result));
      assert.match(
        JSON.parse(result.stdout).error.message,
        /research-project marker must remain an Academic private transparent milestone/u,
      );
      await assert.rejects(readProposalState(fixture));
    }
  });

  it("does not create a recurring research planning marker", async () => {
    const fixture = await setupFixture();
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        kind: "all-day-milestone",
        calendarRole: "Academic",
        evidenceStatus: "provisional",
        summary: "URECA abstract planning marker — Provisional",
        description:
          "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
        recurrence: ["RRULE:FREQ=YEARLY;COUNT=2"],
        date: "2027-02-28",
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /research-project milestones must be singular and non-recurring/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("rejects a research update that promotes a standing marker without evidence", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "ureca-abstract-marker",
          summary: "URECA abstract planning marker — Provisional",
          description:
            "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-28" },
          end: { date: "2027-03-01" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "ureca-abstract-marker",
        patch: {
          summary: "URECA abstract deadline — Confirmed",
          description: "Confirmed exact date.",
        },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /requires item\.evidenceStatus confirmed or provisional/u,
    );
    await assert.rejects(readProposalState(fixture));

    const falselyConfirmedInput = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "ureca-abstract-marker",
        evidenceStatus: "confirmed",
        patch: {
          summary: "URECA abstract deadline",
          description: "Confirmed source: standing programme guidance.",
        },
      },
    });

    const falselyConfirmed = await runCalendarPropose(
      fixture,
      falselyConfirmedInput,
      "--json",
    );

    assert.equal(
      falselyConfirmed.exitCode,
      2,
      JSON.stringify(falselyConfirmed),
    );
    assert.match(
      JSON.parse(falselyConfirmed.stdout).error.message,
      /cannot be marked confirmed/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not let a manual update strip a provisional research marker", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "ureca-abstract-marker",
          summary: "URECA abstract planning marker — Provisional",
          description:
            "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-28" },
          end: { date: "2027-03-01" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "manual",
        reference: "rename-ureca-abstract-marker",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "ureca-abstract-marker",
        patch: {
          summary: "URECA abstract deadline",
          description: "Confirmed exact date.",
        },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not let a manual update strip a confirmed research marker", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "ureca-confirmed-abstract",
          summary: "URECA abstract deadline — Confirmed",
          description:
            "Confirmed source: authenticated AY2026-27 URECA notice captured in the private project evidence.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "manual",
        reference: "rename-ureca-confirmed-abstract",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "ureca-confirmed-abstract",
        patch: {
          summary: "Abstract date",
          description: "Check the portal.",
        },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not move a protected research marker to Routine", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "ureca-abstract-marker",
          summary: "URECA abstract planning marker — Provisional",
          description:
            "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-28" },
          end: { date: "2027-03-01" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        targetCalendarRole: "Routine",
        eventId: "ureca-abstract-marker",
        evidenceStatus: "provisional",
        patch: {},
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /research-project marker must remain an Academic private transparent milestone/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not move a protected research marker to Commitments", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "ureca-abstract-marker",
          summary: "URECA abstract planning marker — Provisional",
          description:
            "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-28" },
          end: { date: "2027-03-01" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        targetCalendarRole: "Commitments",
        eventId: "ureca-abstract-marker",
        evidenceStatus: "provisional",
        patch: {},
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /research-project marker must remain an Academic private transparent milestone/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not make a protected research marker opaque", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "ureca-abstract-marker",
          summary: "URECA abstract planning marker — Provisional",
          description:
            "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-28" },
          end: { date: "2027-03-01" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "ureca-abstract-marker",
        evidenceStatus: "provisional",
        patch: { transparency: "opaque" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /research-project marker must remain an Academic private transparent milestone/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not make a protected research marker recurring", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "ureca-abstract-marker",
          summary: "URECA abstract planning marker — Provisional",
          description:
            "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-28" },
          end: { date: "2027-03-01" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "ureca-abstract-marker",
        evidenceStatus: "provisional",
        patch: { recurrence: ["RRULE:FREQ=YEARLY;COUNT=2"] },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /research-project milestones must be singular and non-recurring/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not make a protected research marker public or default-visible", async () => {
    for (const visibility of ["public", "default"] as const) {
      const fixture = await setupFixture({
        academicEvents: [
          {
            id: "ureca-abstract-marker",
            summary: "URECA abstract planning marker — Provisional",
            description:
              "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
            visibility: "private",
            transparency: "transparent",
            start: { date: "2027-02-28" },
            end: { date: "2027-03-01" },
          },
        ],
      });
      const inputPath = await writeInput(fixture, {
        schemaVersion: 1,
        source: {
          kind: "research-project",
          reference: "ureca-y2/standing-window/end-feb",
        },
        item: {
          operation: "update",
          calendarRole: "Academic",
          eventId: "ureca-abstract-marker",
          evidenceStatus: "provisional",
          patch: { visibility },
        },
      });

      const result = await runCalendarPropose(fixture, inputPath, "--json");

      assert.equal(result.exitCode, 2, JSON.stringify(result));
      assert.match(
        JSON.parse(result.stdout).error.message,
        /research-project marker must remain an Academic private transparent milestone/u,
      );
      await assert.rejects(readProposalState(fixture));
    }
  });

  it("keeps manual updates available for generic milestones", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "club-form-reminder",
          summary: "Submit club form",
          description: "Personal reminder.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "rename-club-form-reminder" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "club-form-reminder",
        patch: { summary: "Submit club registration form" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.stdout).proposal.patch, {
      summary: "Submit club registration form",
    });
  });

  it("does not treat generic Confirmed source text as research provenance", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "club-form-reminder",
          summary: "Submit club form",
          description: "Confirmed source: club committee email.",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "rename-club-form-reminder" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "club-form-reminder",
        patch: { summary: "Submit club registration form" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(
      JSON.parse(result.stdout).proposal.patch.summary,
      "Submit club registration form",
    );
  });

  it("does not let a manual patch manufacture a confirmed research signature", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "club-form-reminder",
          summary: "Submit club form",
          description: "Personal reminder.",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "rename-club-form-reminder" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "club-form-reminder",
        patch: {
          summary: "Submit club form — Confirmed",
          description: "Confirmed source: standing guidance.",
        },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not let a second manual patch complete a confirmed research signature", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "club-form-reminder",
          summary: "Submit club form",
          description: "Confirmed source: standing guidance.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "confirm-club-form-reminder" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "club-form-reminder",
        patch: { summary: "Submit club form — Confirmed" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not let a manual patch manufacture a provisional research signature", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "club-form-reminder",
          summary: "Submit club form",
          description: "Personal reminder.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "rename-club-form-reminder" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "club-form-reminder",
        patch: {
          summary: "Submit club form — Provisional",
          description:
            "Provisional planning marker. Standing source: committee guidance. Verification Task: Confirm the current exact date.",
        },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("does not let a second manual patch complete a provisional research signature", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "club-form-reminder",
          summary: "Submit club form",
          description:
            "Provisional planning marker. Standing source: committee guidance. Verification Task: Confirm the current exact date.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "mark-club-form-provisional" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "club-form-reminder",
        patch: { summary: "Submit club form — Provisional" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("keeps generic milestone reclassification available", async () => {
    const moveFixture = await setupFixture({
      academicEvents: [
        {
          id: "club-form-reminder",
          summary: "Submit club form",
          description: "Personal reminder.",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const moveInput = await writeInput(moveFixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "move-club-form-reminder" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        targetCalendarRole: "Routine",
        eventId: "club-form-reminder",
        patch: {},
      },
    });
    const opacityFixture = await setupFixture({
      academicEvents: [
        {
          id: "club-form-reminder",
          summary: "Submit club form",
          description: "Personal reminder.",
          transparency: "transparent",
          start: { date: "2027-02-23" },
          end: { date: "2027-02-24" },
        },
      ],
    });
    const opacityInput = await writeInput(opacityFixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "block-club-form-reminder" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "club-form-reminder",
        patch: { transparency: "opaque" },
      },
    });

    const move = await runCalendarPropose(moveFixture, moveInput, "--json");
    const opacity = await runCalendarPropose(
      opacityFixture,
      opacityInput,
      "--json",
    );

    assert.equal(move.exitCode, 0, JSON.stringify(move));
    assert.equal(JSON.parse(move.stdout).proposal.itemKind, "routine-event");
    assert.equal(opacity.exitCode, 0, JSON.stringify(opacity));
    assert.equal(JSON.parse(opacity.stdout).proposal.itemKind, "fixed-event");
  });

  it("returns a misplaced research marker to Academic transparent", async () => {
    const fixture = await setupFixture({
      routineEvents: [
        {
          id: "ureca-abstract-marker",
          summary: "URECA abstract planning marker — Provisional",
          description:
            "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
          visibility: "default",
          transparency: "opaque",
          start: { date: "2027-02-28" },
          end: { date: "2027-03-01" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/standing-window/end-feb",
      },
      item: {
        operation: "update",
        calendarRole: "Routine",
        targetCalendarRole: "Academic",
        eventId: "ureca-abstract-marker",
        evidenceStatus: "provisional",
        patch: { transparency: "transparent", visibility: "private" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const proposal = JSON.parse(result.stdout).proposal;
    assert.equal(proposal.operation, "move");
    assert.equal(proposal.target.calendarRole, "Academic");
    assert.equal(proposal.itemKind, "all-day-milestone");
    assert.deepEqual(proposal.patch, {
      transparency: "transparent",
      visibility: "private",
    });
  });

  it("accepts a research update with confirmed evidence and provenance", async () => {
    const fixture = await setupFixture({
      academicEvents: [
        {
          id: "ureca-abstract-marker",
          summary: "URECA abstract planning marker — Provisional",
          description:
            "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
          visibility: "private",
          transparency: "transparent",
          start: { date: "2027-02-28" },
          end: { date: "2027-03-01" },
        },
      ],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: {
        kind: "research-project",
        reference: "ureca-y2/authenticated/abstract-date",
      },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: "ureca-abstract-marker",
        evidenceStatus: "confirmed",
        patch: {
          summary: "URECA abstract deadline — Confirmed",
          description:
            "Confirmed source: authenticated AY2026-27 URECA notice captured in the private project evidence.",
        },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const proposal = JSON.parse(result.stdout).proposal;
    assert.deepEqual(proposal.source, {
      kind: "research-project",
      reference: "ureca-y2/authenticated/abstract-date",
    });
    assert.deepEqual(proposal.patch, {
      summary: "URECA abstract deadline — Confirmed",
      description:
        "Confirmed source: authenticated AY2026-27 URECA notice captured in the private project evidence.",
    });
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

  it("does not let a generic occurrence hide a protected recurring research master", async () => {
    const master = {
      id: "ureca-marker-series",
      summary: "URECA abstract planning marker — Provisional",
      description:
        "Provisional planning marker. Standing source: current programme guidance. Verification Task: Confirm the current exact date.",
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=2"],
      visibility: "private",
      transparency: "transparent",
      start: { date: "2027-02-28" },
      end: { date: "2027-03-01" },
    };
    const occurrence = {
      id: "ureca-marker-series-2028",
      recurringEventId: master.id,
      originalStartTime: { date: "2028-02-28" },
      summary: "Review date",
      description: "Generic occurrence override.",
      visibility: "private",
      transparency: "transparent",
      start: { date: "2028-02-28" },
      end: { date: "2028-02-29" },
    };
    const fixture = await setupFixture({
      academicEvents: [master, occurrence],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "change-review-date-series" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: occurrence.id,
        recurrenceScope: "entire-series",
        patch: { summary: "Changed review date" },
      },
    });
    const futureInputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "change-future-review-dates" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: occurrence.id,
        recurrenceScope: "this-and-future",
        patch: { summary: "Changed future review dates" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");
    const futureResult = await runCalendarPropose(
      fixture,
      futureInputPath,
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    assert.equal(futureResult.exitCode, 2, JSON.stringify(futureResult));
    assert.match(
      JSON.parse(futureResult.stdout).error.message,
      /visible research milestone requires source\.kind research-project/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("fails closed when an entire-series occurrence has no mirrored master", async () => {
    const occurrence = {
      id: "weekly-class-instance",
      recurringEventId: "weekly-class",
      originalStartTime: {
        dateTime: "2026-08-20T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      summary: "Weekly class",
      start: {
        dateTime: "2026-08-20T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T11:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const fixture = await setupFixture({ academicEvents: [occurrence] });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "change-weekly-class" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: occurrence.id,
        recurrenceScope: "entire-series",
        patch: { summary: "Changed weekly class" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      JSON.parse(result.stdout).error.message,
      /entire-series Proposal requires its mirrored recurring master/u,
    );
    await assert.rejects(readProposalState(fixture));
  });

  it("binds the mirrored master when an entire-series occurrence is selected", async () => {
    const master = {
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
    const occurrence = {
      id: "weekly-class-instance",
      recurringEventId: master.id,
      originalStartTime: master.start,
      summary: master.summary,
      start: master.start,
      end: master.end,
    };
    const fixture = await setupFixture({
      academicEvents: [master, occurrence],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "manual", reference: "change-weekly-class" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: occurrence.id,
        recurrenceScope: "entire-series",
        patch: { summary: "Changed weekly class" },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const [dependency] = JSON.parse(result.stdout).proposal
      .recurrenceDependencies;
    assert.equal(dependency.eventId, master.id);
    assert.match(dependency.versionDigest, /^[a-f0-9]{64}$/u);
  });

  it("accepts a recurrence patch for an entire recurring series", async () => {
    const recurringMaster = {
      id: "weekday-lunch",
      summary: "Lunch",
      recurrence: ["RRULE:FREQ=DAILY"],
      start: {
        dateTime: "2026-08-17T12:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-17T13:30:00+08:00",
        timeZone: "Asia/Singapore",
      },
      transparency: "transparent",
      visibility: "private",
    };
    const fixture = await setupFixture({ routineEvents: [recurringMaster] });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "split-weekday-lunch" },
      item: {
        operation: "update",
        calendarRole: "Routine",
        eventId: "weekday-lunch",
        recurrenceScope: "entire-series",
        patch: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] },
      },
    });
    const result = await runCalendarPropose(fixture, inputPath, "--json");
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.stdout).proposal.patch.recurrence, [
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
    ]);
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

  it("allows a transparent milestone duration update over its owning session", async () => {
    const milestone = {
      id: "assessment-milestone",
      summary: "Assessment",
      transparency: "transparent",
      start: {
        dateTime: "2026-08-20T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T10:01:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const session = {
      id: "owning-session",
      summary: "Tutorial",
      start: {
        dateTime: "2026-08-20T10:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-08-20T12:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    };
    const fixture = await setupFixture({
      academicEvents: [milestone, session],
    });
    const inputPath = await writeInput(fixture, {
      schemaVersion: 1,
      source: { kind: "instruction", reference: "duration-milestone" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId: milestone.id,
        patch: {
          end: {
            dateTime: "2026-08-20T12:00:00+08:00",
            timeZone: "Asia/Singapore",
          },
        },
      },
    });

    const result = await runCalendarPropose(fixture, inputPath, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "ready");
    assert.equal(report.proposal.itemKind, "timed-milestone");
    assert.equal(report.proposal.relevantAvailabilityVersion.interval, null);
    assert.deepEqual(report.conflicts, []);
    // Pinned alongside the conflicts, so a conflict demoted to a warning still fails this.
    assert.deepEqual(report.warnings, []);
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
