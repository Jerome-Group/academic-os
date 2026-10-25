import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";

import type {
  CalendarEvent,
  OwnedCalendarMirror,
} from "../../src/calendar/types.js";
import { runCliWithEnvironment } from "../support/run-cli.js";

const roots: string[] = [];
const preload = new URL("../support/fake-calendar-preload.js", import.meta.url)
  .href;
const october = "2026-10-01T00:00:00.000Z";
const victim: CalendarEvent = {
  id: "victim",
  summary: "Retained invitation",
  description: "Last-known recovery details",
  location: "Synthetic room",
  start: { dateTime: "2026-10-15T10:00:00+08:00" },
  end: { dateTime: "2026-10-15T11:00:00+08:00" },
  organizer: { email: "host@example.test", self: false },
  attendees: [{ email: "owner@example.test", self: true }],
  attachments: [{ fileUrl: "https://example.test/fixture", title: "Fixture" }],
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

it("rebuilds an earlier horizon and includes unchanged newly covered items", async () => {
  const f = await fixture();
  const before = await mirror(f);
  const beforeBytes = await readFile(f.mirrorPath, "utf8");
  const september = {
    ...victim,
    id: "september",
    start: { dateTime: "2026-09-15T10:00:00+08:00" },
    end: { dateTime: "2026-09-15T11:00:00+08:00" },
  };
  f.provider.events.academic = [victim, september];
  await reconfigure(f, "2026-09-01T00:00:00.000Z");
  await refresh(f);
  const after = await mirror(f);
  assert.deepEqual(
    after.items.map(({ event }) => event.id),
    ["victim", "september"],
  );
  assert.equal(after.managementHorizon, f.config.calendar.managementHorizon);
  assert.deepEqual(Reflect.get(after, "syncQuery"), {
    singleEvents: false,
    showDeleted: true,
  });
  assertFullRead(f, before.syncToken);
  assert.deepEqual(await archives(f), [beforeBytes]);
});

it("rebuilds a later horizon without inventing deletions or staling proposals", async () => {
  const f = await fixture();
  const before = await readFile(f.mirrorPath, "utf8");
  const proposal = await pending(f);
  f.provider.events.academic = [];
  await reconfigure(f, "2026-11-01T00:00:00.000Z");
  await refresh(f);
  const after = await mirror(f);
  assert.deepEqual(after.items, []);
  assert.deepEqual(after.tombstones, []);
  assert.equal(await readFile(f.proposalsPath, "utf8"), proposal);
  assert.deepEqual(await archives(f), [before]);
  assertFullRead(f);
});

for (const query of [
  undefined,
  { singleEvents: true, showDeleted: true },
  { singleEvents: false, showDeleted: true, maxResults: 5 },
]) {
  it(`fully migrates an unbound token with query ${JSON.stringify(query)}`, async () => {
    const f = await fixture();
    const previous = { ...(await mirror(f)), syncQuery: query };
    await writeFile(f.mirrorPath, JSON.stringify(previous));
    const before = await readFile(f.mirrorPath, "utf8");
    const proposal = await pending(f);
    await assertProposalRefused(f);
    f.provider.events.academic = [{ id: "unchanged-newly-visible" }];
    await refresh(f);
    const after = await mirror(f);
    assert.deepEqual(
      after.items.map(({ event }) => event.id),
      ["unchanged-newly-visible"],
    );
    assert.deepEqual(after.tombstones, []);
    assert.deepEqual(Reflect.get(after, "syncQuery"), {
      singleEvents: false,
      showDeleted: true,
    });
    assertFullRead(f, previous.syncToken);
    assert.equal(await readFile(f.proposalsPath, "utf8"), proposal);
    assert.deepEqual(await archives(f), [before]);
  });
}

it("keeps failed horizon refetch under its original binding and retries fully", async () => {
  const f = await fixture();
  const before = await mirror(f);
  const proposal = await pending(f);
  f.provider.eventReadFailures = ["academic"];
  await reconfigure(f, "2026-11-01T00:00:00.000Z");
  await refresh(f, 2);
  assert.deepEqual(await mirror(f), { ...before, freshness: "stale" });
  assert.equal(await readFile(f.proposalsPath, "utf8"), proposal);
  assertFullRead(f);
  await assertProposalRefused(f);
  f.provider.eventReadFailures = [];
  f.provider.events.academic = [];
  await refresh(f);
  assert.deepEqual((await mirror(f)).items, []);
  assert.deepEqual((await mirror(f)).tombstones, []);
  assertFullRead(f);
});

it("archives an old calendar before replacing it without borrowing its history", async () => {
  const f = await fixture();
  const before = await readFile(f.mirrorPath, "utf8");
  const proposal = await pending(f);
  f.provider.calendars[0] = {
    id: "new-academic",
    summary: "Academic",
    primary: true,
    accessRole: "owner",
  };
  f.provider.events["new-academic"] = [
    { id: "new-live" },
    { id: "victim", status: "cancelled" },
  ];
  await setup(f);
  await refresh(f);
  const after = await mirror(f);
  assert.equal(after.calendarId, "new-academic");
  assert.deepEqual(
    after.items.map(({ event }) => event.id),
    ["new-live"],
  );
  assert.deepEqual(
    after.tombstones.map(({ event }) => event),
    [{ id: "victim", status: "cancelled" }],
  );
  assert.deepEqual(await archives(f), [before]);
  assert.equal(await readFile(f.proposalsPath, "utf8"), proposal);
  assertFullRead(f);
});

it("retains original recovery evidence on a failed calendar rebind and archives it on retry", async () => {
  const f = await fixture();
  const before = await mirror(f);
  const proposal = await pending(f);
  f.provider.calendars[0] = {
    id: "new-academic",
    summary: "Academic",
    primary: true,
    accessRole: "owner",
  };
  f.provider.events["new-academic"] = [];
  f.provider.eventReadFailures = ["new-academic"];
  await setup(f);
  await refresh(f, 2);
  assert.deepEqual(await mirror(f), { ...before, freshness: "stale" });
  assert.equal(await readFile(f.proposalsPath, "utf8"), proposal);
  const staleBytes = await readFile(f.mirrorPath, "utf8");
  await assertProposalRefused(f);
  f.provider.eventReadFailures = [];
  await refresh(f);
  assert.equal((await mirror(f)).calendarId, "new-academic");
  assert.deepEqual((await mirror(f)).tombstones, []);
  assert.deepEqual(await archives(f), [staleBytes]);
  assertFullRead(f);
  await refresh(f);
  assert.deepEqual(await archives(f), [staleBytes]);
});

it("refuses proposals from an old horizon before the new refresh succeeds", async () => {
  const f = await fixture();
  const proposal = await pending(f);
  await reconfigure(f, "2026-11-01T00:00:00.000Z");
  await assertProposalRefused(f);
  assert.equal(await readFile(f.proposalsPath, "utf8"), proposal);
});

it("refuses replacement when its recovery snapshot cannot be persisted", async () => {
  const f = await fixture();
  const before = await readFile(f.mirrorPath, "utf8");
  const proposal = await pending(f);
  await writeFile(f.archiveRoot, "blocked archive path");
  f.provider.events.academic = [];
  await reconfigure(f, "2026-11-01T00:00:00.000Z");
  await refresh(f, 2);
  assert.equal(await readFile(f.mirrorPath, "utf8"), before);
  assert.equal(await readFile(f.proposalsPath, "utf8"), proposal);
  await rm(f.archiveRoot);
  await refresh(f);
  assert.deepEqual(await archives(f), [before]);
});

it("refuses replacement when an existing recovery snapshot fails byte readback", async () => {
  const f = await fixture();
  const before = await readFile(f.mirrorPath);
  await mkdir(f.archiveRoot);
  const digest = createHash("sha256").update(before).digest("hex");
  await writeFile(
    join(f.archiveRoot, `academic-${digest}.json`),
    "corrupt snapshot",
  );
  await reconfigure(f, "2026-11-01T00:00:00.000Z");
  const report = await cli(f, "refresh", 2);
  assert.match(report.error.message, /recovery snapshot failed readback/u);
  assert.deepEqual(await readFile(f.mirrorPath), before);
});

for (const expired of [false, true]) {
  it(`retains full invited cancellation details on ${expired ? "expired-token recovery" : "incremental refresh"}`, async () => {
    const f = await fixture();
    const before = await mirror(f);
    await pending(f);
    if (expired) {
      f.provider.expiredSyncTokens = ["academic-sync"];
      f.provider.events.academic = [{ id: "victim", status: "cancelled" }];
    } else {
      f.provider.incrementalEvents.academic = {
        "academic-sync": [{ id: "victim", status: "cancelled" }],
      };
    }
    await refresh(f);
    const after = await mirror(f);
    assert.deepEqual(after.items, []);
    assert.deepEqual(after.tombstones, [
      {
        access: "invited-read-only",
        event: before.items[0]?.event,
        deletedAt: after.lastSuccessfulRefresh,
      },
    ]);
    const proposal = JSON.parse(await readFile(f.proposalsPath, "utf8"));
    assert.equal(proposal.proposals[0].status, "stale");
    assert.equal(proposal.proposals[0].staleReason, "live-item-deleted");
    const requests = academicRequests(f);
    assert.equal(requests[0]?.params.syncToken, "academic-sync");
    assert.equal(requests.length, expired ? 2 : 1);
    if (expired) assert.equal(requests[1]?.params.timeMin, october);
  });
}

interface Provider {
  calendars: Array<{
    id: string;
    summary: string;
    primary?: boolean;
    accessRole: string;
    etag?: string;
    timeZone?: string;
  }>;
  events: Record<string, CalendarEvent[]>;
  incrementalEvents: Record<string, Record<string, CalendarEvent[]>>;
  nextSyncTokens: Record<string, string>;
  expiredSyncTokens?: string[];
  eventReadFailures?: string[];
  requests: Array<{
    method: string;
    url: string;
    params: {
      syncToken?: string;
      timeMin?: string;
      singleEvents?: boolean;
      showDeleted?: boolean;
    };
  }>;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "academic-os-calendar-binding-"));
  roots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  await Promise.all([mkdir(driveMount), mkdir(stateRoot)]);
  const provider: Provider = {
    calendars: ["Academic", "Commitments", "Routine"].map((role) => ({
      id: role.toLowerCase(),
      summary: role,
      accessRole: "owner",
      etag: `${role}-version`,
      timeZone: "Asia/Singapore",
      ...(role === "Academic" ? { primary: true } : {}),
    })),
    events: { academic: [victim], commitments: [], routine: [] },
    incrementalEvents: {
      academic: { "academic-sync": [] },
      commitments: { "commitments-sync": [] },
      routine: { "routine-sync": [] },
    },
    nextSyncTokens: {
      academic: "academic-sync",
      commitments: "commitments-sync",
      routine: "routine-sync",
      "new-academic": "new-academic-sync",
    },
    requests: [],
  };
  const config = {
    driveMount,
    stateRoot,
    calendar: {
      managementHorizon: october,
      credentials: {
        scheduledRead: join(root, "read.json"),
        interactiveWrite: join(root, "write.json"),
      },
    },
  };
  const f = {
    provider,
    config,
    configPath: join(root, "config.json"),
    providerPath: join(root, "provider.json"),
    mirrorPath: join(stateRoot, "calendar/mirrors/academic.json"),
    archiveRoot: join(stateRoot, "calendar/mirrors/archive"),
    proposalsPath: join(stateRoot, "calendar/pending-proposals.json"),
  };
  await setup(f);
  await refresh(f);
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function cli(
  f: Fixture,
  command: string,
  exitCode = 0,
  args: string[] = [],
) {
  await writeFile(f.configPath, JSON.stringify(f.config));
  f.provider.requests = [];
  await writeFile(f.providerPath, JSON.stringify(f.provider));
  const result = await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_CALENDAR_STATE: f.providerPath,
      NODE_OPTIONS: `--import=${preload}`,
    },
    "calendar",
    command,
    "--config",
    f.configPath,
    "--json",
    ...args,
  );
  assert.equal(result.exitCode, exitCode, JSON.stringify(result));
  f.provider = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.ok(f.provider.requests.every(({ method }) => method === "GET"));
  return JSON.parse(result.stdout);
}
async function setup(f: Fixture) {
  await cli(f, "setup");
}
async function refresh(f: Fixture, exitCode = 0) {
  await cli(f, "refresh", exitCode);
}
async function reconfigure(f: Fixture, horizon: string) {
  f.config.calendar.managementHorizon = horizon;
  await setup(f);
}
async function mirror(f: Fixture): Promise<OwnedCalendarMirror> {
  return JSON.parse(await readFile(f.mirrorPath, "utf8"));
}
function academicRequests(f: Fixture) {
  return f.provider.requests.filter(({ url }) =>
    /\/(?:new-)?academic\/events$/u.test(url),
  );
}
function assertFullRead(f: Fixture, oldToken?: string) {
  const requests = academicRequests(f);
  assert.equal(requests.length, 1);
  assert.notEqual(requests[0]?.params.syncToken, oldToken ?? "academic-sync");
  assert.deepEqual(requests[0]?.params, {
    singleEvents: false,
    showDeleted: true,
    timeMin: f.config.calendar.managementHorizon,
  });
}
async function archives(f: Fixture) {
  return await Promise.all(
    (await readdir(f.archiveRoot))
      .filter((name) => name.startsWith("academic-"))
      .map((name) => readFile(join(f.archiveRoot, name), "utf8")),
  );
}
async function pending(f: Fixture) {
  const value = JSON.stringify({
    schemaVersion: 1,
    proposals: [
      {
        id: "dependent",
        status: "ready",
        liveVersions: [
          {
            calendarRole: "Academic",
            calendarId: "academic",
            eventId: "victim",
          },
        ],
      },
    ],
  });
  await writeFile(f.proposalsPath, value);
  return value;
}

async function assertProposalRefused(f: Fixture) {
  const inputPath = join(f.config.stateRoot, "proposal-input.json");
  await writeFile(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      source: { kind: "instruction", reference: "fixture" },
      item: {
        kind: "fixed-event",
        calendarRole: "Academic",
        summary: "Synthetic proposal",
        start: { dateTime: "2026-11-15T10:00:00+08:00" },
        end: { dateTime: "2026-11-15T11:00:00+08:00" },
      },
    }),
  );
  const report = await cli(f, "propose", 2, ["--input", inputPath]);
  assert.match(
    report.error.message,
    /Calendar Refresh must succeed for Academic/u,
  );
}
