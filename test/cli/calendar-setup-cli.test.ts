import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

describe("academic-os calendar setup", () => {
  it("binds the primary as Academic and reuses existing Owned calendars", async () => {
    const fixture = await setupFixture([
      { id: "primary-id", summary: "Personal", primary: true },
      { id: "commitments-id", summary: "Commitments" },
      { id: "routine-id", summary: "Routine" },
    ]);

    const result = await runCalendarSetup(fixture, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      command: "calendar setup",
      outcome: "configured",
      defaultTimezone: "Asia/Singapore",
      managementHorizon: "2026-08-01T00:00:00.000Z",
      calendars: [
        { role: "Academic", action: "bound", source: "primary" },
        { role: "Commitments", action: "reused", source: "named" },
        { role: "Routine", action: "reused", source: "named" },
      ],
      workspace: "written",
    });
    assert.deepEqual(await readWorkspace(fixture), {
      schemaVersion: 1,
      defaultTimezone: "Asia/Singapore",
      managementHorizon: "2026-08-01T00:00:00.000Z",
      ownedCalendarIds: {
        Academic: "primary-id",
        Commitments: "commitments-id",
        Routine: "routine-id",
      },
    });
    const provider = await readProvider(fixture);
    assert.deepEqual(
      provider.requests.map(({ method, url }) => ({ method, url })),
      [
        {
          method: "GET",
          url: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        },
      ],
    );
  });

  it("previews missing secondary calendars without creating or writing state", async () => {
    const fixture = await setupFixture([
      { id: "primary-id", summary: "Personal", primary: true },
      { id: "routine-id", summary: "Routine" },
    ]);

    const json = await runCalendarSetup(fixture, "--json");
    const human = await runCalendarSetup(fixture);

    assert.equal(json.exitCode, 0, JSON.stringify(json));
    assert.deepEqual(JSON.parse(json.stdout), {
      schemaVersion: 1,
      command: "calendar setup",
      outcome: "preview",
      defaultTimezone: "Asia/Singapore",
      managementHorizon: "2026-08-01T00:00:00.000Z",
      calendars: [
        { role: "Academic", action: "bound", source: "primary" },
        {
          role: "Commitments",
          action: "would-create",
          source: "new",
        },
        { role: "Routine", action: "reused", source: "named" },
      ],
      workspace: "not-written",
    });
    assert.equal(human.exitCode, 0, JSON.stringify(human));
    assert.equal(
      human.stdout,
      [
        "Calendar setup: preview",
        "Default timezone: Asia/Singapore",
        "Management horizon: 2026-08-01T00:00:00.000Z",
        "Academic: bound (primary)",
        "Commitments: would create (new)",
        "Routine: reused (named)",
        "Workspace: not written",
        "",
      ].join("\n"),
    );
    await assert.rejects(
      access(join(fixture.stateRoot, "calendar", "owned-calendars.json")),
    );
    const provider = await readProvider(fixture);
    assert.equal(provider.calendars.length, 2);
    assert.ok(
      provider.requests.every(
        ({ credential, method, scopes }) =>
          credential === fixture.readCredential &&
          method === "GET" &&
          scopes.includes(
            "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
          ),
      ),
    );
  });

  it("creates only previewed missing calendars on apply and is idempotent", async () => {
    const fixture = await setupFixture([
      { id: "primary-id", summary: "Personal", primary: true },
      { id: "routine-id", summary: "Routine" },
    ]);

    const first = await runCalendarSetup(fixture, "--apply", "--json");
    const repeated = await runCalendarSetup(fixture, "--apply", "--json");

    assert.equal(first.exitCode, 0, JSON.stringify(first));
    assert.deepEqual(JSON.parse(first.stdout).calendars, [
      { role: "Academic", action: "bound", source: "primary" },
      { role: "Commitments", action: "created", source: "new" },
      { role: "Routine", action: "reused", source: "named" },
    ]);
    assert.equal(repeated.exitCode, 0, JSON.stringify(repeated));
    assert.deepEqual(JSON.parse(repeated.stdout).calendars, [
      { role: "Academic", action: "bound", source: "primary" },
      { role: "Commitments", action: "reused", source: "named" },
      { role: "Routine", action: "reused", source: "named" },
    ]);
    const provider = await readProvider(fixture);
    assert.deepEqual(
      provider.calendars.map(({ id, summary }) => ({ id, summary })),
      [
        { id: "primary-id", summary: "Personal" },
        { id: "routine-id", summary: "Routine" },
        { id: "created-1", summary: "Commitments" },
      ],
    );
    const creates = provider.requests.filter(({ method }) => method === "POST");
    assert.equal(creates.length, 1);
    assert.equal(creates[0]?.credential, fixture.writeCredential);
    assert.deepEqual(creates[0]?.scopes, [
      "https://www.googleapis.com/auth/calendar.calendars",
    ]);
    assert.deepEqual(await readWorkspace(fixture), {
      schemaVersion: 1,
      defaultTimezone: "Asia/Singapore",
      managementHorizon: "2026-08-01T00:00:00.000Z",
      ownedCalendarIds: {
        Academic: "primary-id",
        Commitments: "created-1",
        Routine: "routine-id",
      },
    });
  });

  it("rejects shared credential configuration before provider access", async () => {
    const fixture = await setupFixture([
      { id: "primary-id", summary: "Personal", primary: true },
    ]);
    const config = JSON.parse(await readFile(fixture.configPath, "utf8"));
    config.calendar.credentials.interactiveWrite = fixture.readCredential;
    await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`);

    const result = await runCalendarSetup(fixture, "--json");

    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-config");
    assert.deepEqual((await readProvider(fixture)).requests ?? [], []);
  });

  it("blocks ambiguous named calendars without creation", async () => {
    const fixture = await setupFixture([
      { id: "primary-id", summary: "Personal", primary: true },
      { id: "commitments-1", summary: "Commitments" },
      { id: "commitments-2", summary: "Commitments" },
      { id: "routine-id", summary: "Routine" },
    ]);

    const result = await runCalendarSetup(fixture, "--apply", "--json");

    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "ambiguous-target");
    const provider = await readProvider(fixture);
    assert.equal(
      provider.requests.filter(({ method }) => method === "POST").length,
      0,
    );
    await assert.rejects(
      access(join(fixture.stateRoot, "calendar", "owned-calendars.json")),
    );
  });
});

interface CalendarFixture {
  configPath: string;
  providerPath: string;
  readCredential: string;
  stateRoot: string;
  writeCredential: string;
}

async function setupFixture(
  calendars: Array<{ id: string; summary: string; primary?: boolean }>,
): Promise<CalendarFixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-calendar-cli-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  await Promise.all([mkdir(driveMount), mkdir(stateRoot)]);
  const configPath = join(root, "academic-os.config.json");
  const readCredential = join(root, "calendar-read.credentials.json");
  const writeCredential = join(root, "calendar-write.credentials.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      driveMount,
      stateRoot,
      calendar: {
        managementHorizon: "2026-08-01T08:00:00+08:00",
        credentials: {
          scheduledRead: readCredential,
          interactiveWrite: writeCredential,
        },
      },
    })}\n`,
  );
  const providerPath = join(root, "provider.json");
  await writeFile(providerPath, `${JSON.stringify({ calendars })}\n`);
  return {
    configPath,
    providerPath,
    readCredential,
    stateRoot,
    writeCredential,
  };
}

async function runCalendarSetup(
  fixture: CalendarFixture,
  ...arguments_: string[]
) {
  return await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_CALENDAR_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${fakeCalendarPreload}`,
    },
    "calendar",
    "setup",
    "--config",
    fixture.configPath,
    ...arguments_,
  );
}

async function readWorkspace(fixture: CalendarFixture): Promise<unknown> {
  return JSON.parse(
    await readFile(
      join(fixture.stateRoot, "calendar", "owned-calendars.json"),
      "utf8",
    ),
  );
}

async function readProvider(fixture: CalendarFixture): Promise<{
  calendars: Array<{ id: string; summary: string; primary?: boolean }>;
  requests: Array<{
    credential: string;
    method: string;
    scopes: string[];
    url: string;
  }>;
}> {
  return JSON.parse(await readFile(fixture.providerPath, "utf8"));
}
