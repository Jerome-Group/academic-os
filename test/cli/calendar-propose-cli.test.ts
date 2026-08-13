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
    Routine: [],
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
        "routine-id": [],
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
