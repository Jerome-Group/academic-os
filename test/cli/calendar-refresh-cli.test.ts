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

describe("academic-os calendar refresh", () => {
  it("mirrors the complete forward Live calendar without provider mutation", async () => {
    const fixture = await setupFixture();
    const pendingProposal =
      '{"schemaVersion":1,"proposals":[{"id":"pending"}]}\n';
    await writeFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      pendingProposal,
    );

    const jsonResult = await runCalendarRefresh(fixture, "--json");
    const humanResult = await runCalendarRefresh(fixture);

    assert.equal(jsonResult.exitCode, 0, JSON.stringify(jsonResult));
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.command, "calendar refresh");
    assert.equal(report.outcome, "refreshed");
    assert.equal(report.managementHorizon, "2026-08-01T00:00:00.000Z");
    assert.deepEqual(
      report.calendars.map(
        ({ role, freshness, counts }: Record<string, unknown>) => ({
          role,
          freshness,
          counts,
        }),
      ),
      [
        {
          role: "Academic",
          freshness: "fresh",
          counts: {
            items: 4,
            recurringMasters: 1,
            exceptions: 1,
            invited: 1,
          },
        },
        {
          role: "Commitments",
          freshness: "fresh",
          counts: {
            items: 1,
            recurringMasters: 0,
            exceptions: 0,
            invited: 0,
          },
        },
        {
          role: "Routine",
          freshness: "fresh",
          counts: {
            items: 1,
            recurringMasters: 1,
            exceptions: 0,
            invited: 0,
          },
        },
      ],
    );
    assert.ok(
      report.calendars.every(
        ({ refreshedAt }: { refreshedAt: string }) =>
          !Number.isNaN(Date.parse(refreshedAt)),
      ),
    );
    assert.deepEqual(report.placementSuggestions, [
      {
        eventId: "routine-on-primary",
        summary: "Sleep",
        actualRole: "Academic",
        suggestedRole: "Routine",
        reason: "transparent-recurring",
      },
    ]);

    assert.equal(humanResult.exitCode, 0, JSON.stringify(humanResult));
    assert.match(humanResult.stdout, /^Calendar refresh: refreshed$/mu);
    assert.match(
      humanResult.stdout,
      /^Academic: 4 items, 1 recurring master, 1 exception, 1 invited; fresh at .+$/mu,
    );
    assert.match(
      humanResult.stdout,
      /^Commitments: 1 item, 0 recurring masters, 0 exceptions, 0 invited; fresh at .+$/mu,
    );
    assert.match(
      humanResult.stdout,
      /^Routine: 1 item, 1 recurring master, 0 exceptions, 0 invited; fresh at .+$/mu,
    );
    assert.match(humanResult.stdout, /^Placement suggestions: 1$/mu);
    assert.match(
      humanResult.stdout,
      /^routine-on-primary "Sleep": Academic -> Routine \(transparent recurring\)$/mu,
    );

    const academicMirror = await readMirror(fixture, "academic");
    assert.equal(academicMirror.role, "Academic");
    assert.equal(academicMirror.managementHorizon, "2026-08-01T00:00:00.000Z");
    assert.deepEqual(
      academicMirror.items.map(
        ({ actualCalendarRole, access, event }: Record<string, unknown>) => ({
          actualCalendarRole,
          access,
          id: (event as { id: string }).id,
        }),
      ),
      [
        {
          actualCalendarRole: "Academic",
          access: "owned",
          id: "class",
        },
        {
          actualCalendarRole: "Academic",
          access: "invited-read-only",
          id: "invitation",
        },
        {
          actualCalendarRole: "Academic",
          access: "owned",
          id: "routine-on-primary",
        },
        {
          actualCalendarRole: "Academic",
          access: "owned",
          id: "routine-exception",
        },
      ],
    );
    assert.deepEqual(
      (academicMirror.items[2] as { event: unknown }).event,
      fixture.events["academic-id"]?.[2],
    );
    assert.deepEqual(
      (academicMirror.items[3] as { event: unknown }).event,
      fixture.events["academic-id"]?.[3],
    );
    assert.equal(
      await readFile(
        join(fixture.calendarRoot, "pending-proposals.json"),
        "utf8",
      ),
      pendingProposal,
    );

    const provider = await readProvider(fixture);
    assert.equal(provider.requests.length, 8);
    assert.ok(
      provider.requests.every(
        ({ credential, method, scopes, params }) =>
          credential === fixture.readCredential &&
          method === "GET" &&
          scopes.length === 1 &&
          scopes[0] ===
            "https://www.googleapis.com/auth/calendar.events.readonly" &&
          params?.timeMin === "2026-08-01T00:00:00.000Z" &&
          params?.singleEvents === false &&
          params?.showDeleted === false &&
          !("timeMax" in params),
      ),
    );
    assert.deepEqual(
      provider.requests
        .filter(({ url }) => url.includes("academic-id"))
        .map(({ params }) => params.pageToken),
      [undefined, "2", undefined, "2"],
    );
  });

  it("keeps every last-good mirror when a complete full read fails", async () => {
    const fixture = await setupFixture(["commitments-id"]);
    const prior = '{"schemaVersion":1,"marker":"last-good"}\n';
    await Promise.all(
      ["academic", "commitments", "routine"].map((role) =>
        writeFile(join(fixture.mirrorsRoot, `${role}.json`), prior),
      ),
    );

    const result = await runCalendarRefresh(fixture, "--json");

    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "operational-failure");
    assert.deepEqual(
      await Promise.all(
        ["academic", "commitments", "routine"].map((role) =>
          readFile(join(fixture.mirrorsRoot, `${role}.json`), "utf8"),
        ),
      ),
      [prior, prior, prior],
    );
    const provider = await readProvider(fixture);
    assert.ok(provider.requests.every(({ method }) => method === "GET"));
  });
});

interface CalendarFixture {
  calendarRoot: string;
  configPath: string;
  events: Record<string, unknown[]>;
  mirrorsRoot: string;
  providerPath: string;
  readCredential: string;
}

async function setupFixture(
  eventReadFailures: string[] = [],
): Promise<CalendarFixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-calendar-refresh-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const calendarRoot = join(stateRoot, "calendar");
  const mirrorsRoot = join(calendarRoot, "mirrors");
  await Promise.all([
    mkdir(driveMount),
    mkdir(mirrorsRoot, { recursive: true }),
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
  const events: Record<string, unknown[]> = {
    "academic-id": [
      {
        id: "class",
        summary: "Algebra class",
        start: { dateTime: "2026-08-03T09:00:00+08:00" },
        end: { dateTime: "2026-08-03T10:00:00+08:00" },
        organizer: { email: "owner@example.test", self: true },
      },
      {
        id: "invitation",
        summary: "External meeting",
        start: { dateTime: "2026-08-04T09:00:00+08:00" },
        end: { dateTime: "2026-08-04T10:00:00+08:00" },
        organizer: { email: "host@example.test", self: false },
        attendees: [{ email: "owner@example.test", self: true }],
      },
      {
        id: "routine-on-primary",
        summary: "Sleep",
        start: { dateTime: "2026-08-01T23:00:00+08:00" },
        end: { dateTime: "2026-08-02T07:00:00+08:00" },
        transparency: "transparent",
        recurrence: ["RRULE:FREQ=DAILY"],
        organizer: { email: "owner@example.test", self: true },
      },
      {
        id: "routine-exception",
        status: "cancelled",
        recurringEventId: "routine-on-primary",
        originalStartTime: { dateTime: "2026-08-05T23:00:00+08:00" },
        start: { dateTime: "2026-08-06T00:00:00+08:00" },
        end: { dateTime: "2026-08-06T08:00:00+08:00" },
        organizer: { email: "owner@example.test", self: true },
      },
    ],
    "commitments-id": [
      {
        id: "appointment",
        summary: "Appointment",
        start: { dateTime: "2026-08-07T10:00:00+08:00" },
        end: { dateTime: "2026-08-07T11:00:00+08:00" },
        organizer: { email: "owner@example.test", self: true },
      },
    ],
    "routine-id": [
      {
        id: "exercise",
        summary: "Exercise",
        start: { dateTime: "2026-08-02T08:00:00+08:00" },
        end: { dateTime: "2026-08-02T09:00:00+08:00" },
        transparency: "transparent",
        recurrence: ["RRULE:FREQ=WEEKLY"],
        organizer: { email: "owner@example.test", self: true },
      },
    ],
  };
  const providerPath = join(root, "provider.json");
  await writeFile(
    providerPath,
    `${JSON.stringify({
      calendars: [],
      events,
      eventReadFailures,
      eventPageSizes: { "academic-id": 2 },
    })}\n`,
  );
  return {
    calendarRoot,
    configPath,
    events,
    mirrorsRoot,
    providerPath,
    readCredential,
  };
}

async function runCalendarRefresh(
  fixture: CalendarFixture,
  ...arguments_: string[]
) {
  return await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_CALENDAR_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${fakeCalendarPreload}`,
    },
    "calendar",
    "refresh",
    "--config",
    fixture.configPath,
    ...arguments_,
  );
}

async function readMirror(
  fixture: CalendarFixture,
  role: "academic" | "commitments" | "routine",
): Promise<
  Record<string, unknown> & { items: Array<Record<string, unknown>> }
> {
  return JSON.parse(
    await readFile(join(fixture.mirrorsRoot, `${role}.json`), "utf8"),
  );
}

async function readProvider(fixture: CalendarFixture): Promise<{
  requests: Array<{
    credential: string;
    method: string;
    params: {
      pageToken?: string;
      showDeleted: boolean;
      singleEvents: boolean;
      timeMin: string;
      timeMax?: string;
    };
    scopes: string[];
    url: string;
  }>;
}> {
  return JSON.parse(await readFile(fixture.providerPath, "utf8"));
}
