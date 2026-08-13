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
            items: 3,
            recurringMasters: 1,
            exceptions: 0,
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
        ({ lastSuccessfulRefresh }: { lastSuccessfulRefresh: string }) =>
          !Number.isNaN(Date.parse(lastSuccessfulRefresh)),
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
      /^Academic: 3 items, 1 recurring master, 0 exceptions, 1 invited; fresh; last successful Refresh .+$/mu,
    );
    assert.match(
      humanResult.stdout,
      /^Commitments: 1 item, 0 recurring masters, 0 exceptions, 0 invited; fresh; last successful Refresh .+$/mu,
    );
    assert.match(
      humanResult.stdout,
      /^Routine: 1 item, 1 recurring master, 0 exceptions, 0 invited; fresh; last successful Refresh .+$/mu,
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
      ],
    );
    assert.deepEqual(
      (academicMirror.items[2] as { event: unknown }).event,
      fixture.events["academic-id"]?.[2],
    );
    assert.equal(academicMirror.tombstones.length, 1);
    assert.ok(
      !Number.isNaN(
        Date.parse(String(academicMirror.tombstones[0]?.deletedAt)),
      ),
    );
    assert.deepEqual(
      academicMirror.tombstones[0]?.event,
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
    assert.equal(provider.requests.length, 7);
    assert.ok(
      provider.requests.every(
        ({ credential, method, scopes, params }) =>
          credential === fixture.readCredential &&
          method === "GET" &&
          scopes.length === 1 &&
          scopes[0] ===
            "https://www.googleapis.com/auth/calendar.events.readonly" &&
          params?.singleEvents === false &&
          params?.showDeleted === true &&
          !("timeMax" in params),
      ),
    );
    assert.deepEqual(
      provider.requests
        .filter(({ url }) => url.includes("academic-id"))
        .map(({ params }) => params.pageToken),
      [undefined, "2", undefined],
    );
    assert.deepEqual(
      provider.requests
        .filter(({ params }) => params.syncToken === undefined)
        .map(({ params }) => params.timeMin),
      [
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      ],
    );
    assert.deepEqual(
      provider.requests
        .filter(({ params }) => params.syncToken !== undefined)
        .map(({ params }) => params.syncToken),
      ["academic-sync-1", "commitments-sync-1", "routine-sync-1"],
    );
  });

  it("advances successful calendars while a failed calendar keeps last-good stale state", async () => {
    const fixture = await setupFixture();
    const initial = await runCalendarRefresh(fixture, "--json");
    assert.equal(initial.exitCode, 0, JSON.stringify(initial));
    const lastGoodCommitments = await readMirror(fixture, "commitments");
    const provider = await readProvider(fixture);
    provider.eventReadFailures = ["commitments-id"];
    provider.incrementalEvents = {
      "academic-id": {
        "academic-sync-1": [
          {
            id: "new-class",
            summary: "New class",
            start: { dateTime: "2026-08-08T09:00:00+08:00" },
            end: { dateTime: "2026-08-08T10:00:00+08:00" },
          },
        ],
      },
      "routine-id": { "routine-sync-1": [] },
    };
    provider.nextSyncTokens = {
      "academic-id": "academic-sync-2",
      "commitments-id": "commitments-sync-2",
      "routine-id": "routine-sync-2",
    };
    await writeProvider(fixture, provider);

    const result = await runCalendarRefresh(fixture, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partially-refreshed");
    assert.deepEqual(
      report.calendars.map(
        ({
          role,
          freshness,
          lastSuccessfulRefresh,
        }: Record<string, unknown>) => ({
          role,
          freshness,
          lastSuccessfulRefresh,
        }),
      ),
      [
        {
          role: "Academic",
          freshness: "fresh",
          lastSuccessfulRefresh: report.calendars[0].lastSuccessfulRefresh,
        },
        {
          role: "Commitments",
          freshness: "stale",
          lastSuccessfulRefresh: lastGoodCommitments.lastSuccessfulRefresh,
        },
        {
          role: "Routine",
          freshness: "fresh",
          lastSuccessfulRefresh: report.calendars[2].lastSuccessfulRefresh,
        },
      ],
    );

    const academic = await readMirror(fixture, "academic");
    const commitments = await readMirror(fixture, "commitments");
    const routine = await readMirror(fixture, "routine");
    assert.equal(academic.syncToken, "academic-sync-2");
    assert.equal(academic.items.length, 4);
    assert.equal(commitments.freshness, "stale");
    assert.equal(commitments.syncToken, "commitments-sync-1");
    assert.equal(
      commitments.lastSuccessfulRefresh,
      lastGoodCommitments.lastSuccessfulRefresh,
    );
    assert.deepEqual(commitments.items, lastGoodCommitments.items);
    assert.equal(routine.syncToken, "routine-sync-2");
  });

  it("retains deletion tombstones and marks dependent Proposals stale", async () => {
    const fixture = await setupFixture();
    assert.equal((await runCalendarRefresh(fixture, "--json")).exitCode, 0);
    await writeFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        proposals: [
          {
            id: "dependent",
            status: "ready",
            liveVersions: [
              {
                calendarRole: "Academic",
                eventId: "class",
                etag: "class-v1",
              },
            ],
          },
          {
            id: "unrelated",
            status: "ready",
            liveVersions: [
              {
                calendarRole: "Routine",
                eventId: "exercise",
                etag: "exercise-v1",
              },
            ],
          },
        ],
      })}\n`,
    );
    const provider = await readProvider(fixture);
    provider.incrementalEvents = {
      "academic-id": {
        "academic-sync-1": [{ id: "class", status: "cancelled" }],
      },
      "commitments-id": { "commitments-sync-1": [] },
      "routine-id": { "routine-sync-1": [] },
    };
    provider.nextSyncTokens = {
      "academic-id": "academic-sync-2",
      "commitments-id": "commitments-sync-2",
      "routine-id": "routine-sync-2",
    };
    await writeProvider(fixture, provider);

    const result = await runCalendarRefresh(fixture, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const academic = await readMirror(fixture, "academic");
    assert.equal(
      academic.items.some(
        ({ event }) => (event as { id: string }).id === "class",
      ),
      false,
    );
    assert.equal(academic.tombstones.length, 2);
    assert.deepEqual(
      academic.tombstones.find(
        ({ event }) => (event as { id: string }).id === "class",
      ),
      {
        access: "owned",
        deletedAt: academic.lastSuccessfulRefresh,
        event: fixture.events["academic-id"]?.[0],
      },
    );
    const proposals = JSON.parse(
      await readFile(
        join(fixture.calendarRoot, "pending-proposals.json"),
        "utf8",
      ),
    );
    assert.equal(proposals.proposals[0].status, "stale");
    assert.equal(proposals.proposals[0].staleReason, "live-item-deleted");
    assert.equal(proposals.proposals[1].status, "ready");
  });

  it("recovers an expired token with a paginated forward read without losing private state", async () => {
    const fixture = await setupFixture();
    assert.equal((await runCalendarRefresh(fixture, "--json")).exitCode, 0);
    const pendingProposals = {
      schemaVersion: 1,
      proposals: [{ id: "pending-create", status: "ready" }],
    };
    await writeFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      `${JSON.stringify(pendingProposals)}\n`,
    );
    const providerAfterInitial = await readProvider(fixture);
    providerAfterInitial.incrementalEvents = {
      "academic-id": {
        "academic-sync-1": [{ id: "class", status: "cancelled" }],
      },
      "commitments-id": { "commitments-sync-1": [] },
      "routine-id": { "routine-sync-1": [] },
    };
    providerAfterInitial.nextSyncTokens = {
      "academic-id": "academic-sync-2",
      "commitments-id": "commitments-sync-2",
      "routine-id": "routine-sync-2",
    };
    await writeProvider(fixture, providerAfterInitial);
    assert.equal((await runCalendarRefresh(fixture, "--json")).exitCode, 0);

    const provider = await readProvider(fixture);
    provider.expiredSyncTokens = ["academic-sync-2"];
    provider.events = {
      ...fixture.events,
      "academic-id": fixture.events["academic-id"]?.slice(1) ?? [],
    };
    provider.incrementalEvents = {
      "commitments-id": { "commitments-sync-2": [] },
      "routine-id": { "routine-sync-2": [] },
    };
    provider.nextSyncTokens = {
      "academic-id": "academic-sync-3",
      "commitments-id": "commitments-sync-3",
      "routine-id": "routine-sync-3",
    };
    await writeProvider(fixture, provider);

    const result = await runCalendarRefresh(fixture, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const academic = await readMirror(fixture, "academic");
    assert.equal(academic.syncToken, "academic-sync-3");
    assert.equal(academic.items.length, 2);
    assert.equal(academic.tombstones.length, 2);
    assert.ok(
      academic.tombstones.some(
        ({ event }) => (event as { id: string }).id === "class",
      ),
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(fixture.calendarRoot, "pending-proposals.json"),
          "utf8",
        ),
      ),
      pendingProposals,
    );
    const requests = (await readProvider(fixture)).requests;
    const recoveryRequests = requests.slice(-5);
    assert.deepEqual(
      recoveryRequests.map(({ params }) => ({
        pageToken: params.pageToken,
        syncToken: params.syncToken,
        timeMin: params.timeMin,
      })),
      [
        {
          pageToken: undefined,
          syncToken: "academic-sync-2",
          timeMin: undefined,
        },
        {
          pageToken: undefined,
          syncToken: undefined,
          timeMin: "2026-08-01T00:00:00.000Z",
        },
        {
          pageToken: "2",
          syncToken: undefined,
          timeMin: "2026-08-01T00:00:00.000Z",
        },
        {
          pageToken: undefined,
          syncToken: "commitments-sync-2",
          timeMin: undefined,
        },
        {
          pageToken: undefined,
          syncToken: "routine-sync-2",
          timeMin: undefined,
        },
      ],
    );
  });

  it("turns items omitted by expired-token recovery into tombstones", async () => {
    const fixture = await setupFixture();
    assert.equal((await runCalendarRefresh(fixture, "--json")).exitCode, 0);
    await writeFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        proposals: [
          {
            id: "dependent",
            status: "ready",
            liveVersions: [{ calendarRole: "Academic", eventId: "class" }],
          },
        ],
      })}\n`,
    );
    const provider = await readProvider(fixture);
    provider.expiredSyncTokens = ["academic-sync-1"];
    provider.events = {
      ...fixture.events,
      "academic-id": fixture.events["academic-id"]?.slice(1) ?? [],
    };
    provider.nextSyncTokens = {
      "academic-id": "academic-sync-2",
      "commitments-id": "commitments-sync-2",
      "routine-id": "routine-sync-2",
    };
    await writeProvider(fixture, provider);

    const result = await runCalendarRefresh(fixture, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const academic = await readMirror(fixture, "academic");
    assert.ok(
      academic.tombstones.some(
        ({ event }) => (event as { id: string }).id === "class",
      ),
    );
    const proposals = JSON.parse(
      await readFile(
        join(fixture.calendarRoot, "pending-proposals.json"),
        "utf8",
      ),
    );
    assert.equal(proposals.proposals[0].status, "stale");
    assert.equal(proposals.proposals[0].staleReason, "live-item-deleted");
  });

  it("does not advance a deletion token until dependent Proposal staleness is durable", async () => {
    const fixture = await setupFixture();
    assert.equal((await runCalendarRefresh(fixture, "--json")).exitCode, 0);
    const lastGoodAcademic = await readMirror(fixture, "academic");
    await writeFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      "invalid private Proposal state\n",
    );
    const provider = await readProvider(fixture);
    provider.incrementalEvents = {
      "academic-id": {
        "academic-sync-1": [{ id: "class", status: "cancelled" }],
      },
      "commitments-id": { "commitments-sync-1": [] },
      "routine-id": { "routine-sync-1": [] },
    };
    provider.nextSyncTokens = {
      "academic-id": "academic-sync-2",
      "commitments-id": "commitments-sync-2",
      "routine-id": "routine-sync-2",
    };
    await writeProvider(fixture, provider);

    const failed = await runCalendarRefresh(fixture, "--json");

    assert.equal(failed.exitCode, 2, JSON.stringify(failed));
    assert.equal(JSON.parse(failed.stdout).outcome, "operational-failure");
    const unchangedAcademic = await readMirror(fixture, "academic");
    assert.equal(unchangedAcademic.syncToken, "academic-sync-1");
    assert.deepEqual(unchangedAcademic.items, lastGoodAcademic.items);

    await writeFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        proposals: [
          {
            id: "dependent",
            status: "ready",
            liveVersions: [{ calendarRole: "Academic", eventId: "class" }],
          },
        ],
      })}\n`,
    );
    const recovered = await runCalendarRefresh(fixture, "--json");
    assert.equal(recovered.exitCode, 0, JSON.stringify(recovered));
    const proposals = JSON.parse(
      await readFile(
        join(fixture.calendarRoot, "pending-proposals.json"),
        "utf8",
      ),
    );
    assert.equal(proposals.proposals[0].status, "stale");
  });

  it("does not publish a partial page and names stale last-good state in human output", async () => {
    const fixture = await setupFixture();
    assert.equal((await runCalendarRefresh(fixture, "--json")).exitCode, 0);
    const lastGoodAcademic = await readMirror(fixture, "academic");
    const provider = await readProvider(fixture);
    provider.incrementalEvents = {
      "academic-id": {
        "academic-sync-1": [
          { id: "change-1" },
          { id: "change-2" },
          { id: "change-3" },
        ],
      },
      "commitments-id": { "commitments-sync-1": [] },
      "routine-id": { "routine-sync-1": [] },
    };
    provider.eventPageSizes = { "academic-id": 1 };
    provider.eventPageFailures = { "academic-id": ["1"] };
    provider.nextSyncTokens = {
      "academic-id": "academic-sync-2",
      "commitments-id": "commitments-sync-2",
      "routine-id": "routine-sync-2",
    };
    await writeProvider(fixture, provider);

    const result = await runCalendarRefresh(fixture);

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(result.stdout, /^Calendar refresh: partially-refreshed$/mu);
    assert.match(
      result.stdout,
      new RegExp(
        `^Academic: 3 items, 1 recurring master, 0 exceptions, 1 invited; stale; last successful Refresh ${lastGoodAcademic.lastSuccessfulRefresh}$`,
        "mu",
      ),
    );
    const academic = await readMirror(fixture, "academic");
    assert.equal(academic.freshness, "stale");
    assert.equal(academic.syncToken, "academic-sync-1");
    assert.deepEqual(academic.items, lastGoodAcademic.items);
    assert.deepEqual(
      (await readProvider(fixture)).requests
        .filter(({ url }) => url.includes("academic-id"))
        .slice(-2)
        .map(({ params }) => ({
          pageToken: params.pageToken,
          syncToken: params.syncToken,
        })),
      [
        { pageToken: undefined, syncToken: "academic-sync-1" },
        { pageToken: "1", syncToken: "academic-sync-1" },
      ],
    );
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
      nextSyncTokens: {
        "academic-id": "academic-sync-1",
        "commitments-id": "commitments-sync-1",
        "routine-id": "routine-sync-1",
      },
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
  Record<string, unknown> & {
    items: Array<Record<string, unknown>>;
    tombstones: Array<Record<string, unknown>>;
  }
> {
  return JSON.parse(
    await readFile(join(fixture.mirrorsRoot, `${role}.json`), "utf8"),
  );
}

async function readProvider(fixture: CalendarFixture): Promise<{
  eventReadFailures?: string[];
  eventPageFailures?: Record<string, string[]>;
  eventPageSizes?: Record<string, number>;
  expiredSyncTokens?: string[];
  events?: Record<string, unknown[]>;
  incrementalEvents?: Record<string, Record<string, unknown[]>>;
  nextSyncTokens?: Record<string, string>;
  requests: Array<{
    credential: string;
    method: string;
    params: {
      pageToken?: string;
      showDeleted: boolean;
      singleEvents: boolean;
      syncToken?: string;
      timeMin?: string;
      timeMax?: string;
    };
    scopes: string[];
    url: string;
  }>;
}> {
  return JSON.parse(await readFile(fixture.providerPath, "utf8"));
}

async function writeProvider(
  fixture: CalendarFixture,
  provider: Awaited<ReturnType<typeof readProvider>>,
): Promise<void> {
  await writeFile(fixture.providerPath, `${JSON.stringify(provider)}\n`);
}
