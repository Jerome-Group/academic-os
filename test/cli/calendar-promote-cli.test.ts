import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { calendarStateDigest } from "../../src/calendar/index.js";
import { reviewCalendarProposalFixture } from "../support/review-calendar-proposal-fixture.js";
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

describe("academic-os calendar promote", () => {
  for (const ambiguous of [false, true]) {
    it(`promotes a public fixed-event Proposal with Google defaults after ${ambiguous ? "a lost" : "a successful"} response and retries once`, async () => {
      const fixture = await setupFixture();
      const inputPath = join(fixture.inputRoot, "fixed-event.json");
      await writeFile(
        inputPath,
        `${JSON.stringify({
          schemaVersion: 1,
          source: { kind: "instruction", reference: "private-fixed-event" },
          item: {
            kind: "fixed-event",
            calendarRole: "Academic",
            summary: "Topology seminar",
            start: { dateTime: "2026-08-20T10:00:00+08:00" },
            end: { dateTime: "2026-08-20T11:00:00+08:00" },
          },
        })}\n`,
      );
      const proposed = await runCalendarPropose(fixture, inputPath, "--json");
      assert.equal(proposed.exitCode, 0, JSON.stringify(proposed));
      const preview = JSON.parse(proposed.stdout);
      assert.equal(preview.outcome, "ready");
      const proposal = preview.proposal;
      assert.equal(proposal.intendedEvent.eventType, undefined);
      const eventId = `a${crypto.createHash("sha256").update(proposal.idempotencyKey).digest("hex").slice(0, 31)}`;
      await mutateProvider(fixture, (provider) => {
        provider.createdEventOverrides = {
          [eventId]: {
            kind: "calendar#event",
            etag: '"provider-version"',
            status: "confirmed",
            htmlLink: "https://example.invalid/calendar/event",
            created: "2026-08-19T21:00:00.000Z",
            updated: "2026-08-19T21:00:00.000Z",
            creator: { email: "owner@example.invalid" },
            organizer: { email: "calendar@example.invalid", self: true },
            iCalUID: `${eventId}@google.com`,
            sequence: 0,
            reminders: { useDefault: true },
            eventType: "default",
          },
        };
        if (ambiguous) provider.ambiguousCreateFailures = [eventId];
      });

      const promoted = await runPromote(fixture, proposal.id, "--json");
      assert.equal(promoted.exitCode, 0, JSON.stringify(promoted));
      const report = JSON.parse(promoted.stdout);
      assert.equal(report.outcome, "promoted");
      assert.equal(report.verifiedEvent.id, eventId);
      assert.equal(report.verifiedEvent.eventType, "default");
      const retry = await runPromote(fixture, proposal.id, "--json");
      assert.equal(retry.exitCode, 0, JSON.stringify(retry));
      assert.equal(JSON.parse(retry.stdout).outcome, "retry");
      const provider = await readProvider(fixture);
      assert.equal(provider.events["academic-id"]?.length, 1);
      assert.equal(
        provider.requests.filter(({ method }) => method === "POST").length,
        1,
      );
      const journal = await readFile(
        join(fixture.calendarRoot, "promotions.jsonl"),
        "utf8",
      );
      assert.equal(journal.trim().split("\n").length, 1);
    });
  }

  it("promotes one bulk Academic Proposal and retries without duplicates", async () => {
    const fixture = await setupFixture();
    const inputPath = join(fixture.inputRoot, "academic-timetable.json");
    await writeFile(
      inputPath,
      `${JSON.stringify({
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
              key: "cc0006-examless",
              summary: "CC0006 TUT T004",
              weekday: "MO",
              startTime: "09:30",
              endTime: "11:20",
              weeks: { week: 2 },
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
      })}\n`,
    );
    const proposed = await runCalendarPropose(fixture, inputPath, "--json");
    assert.equal(proposed.exitCode, 0, JSON.stringify(proposed));
    const proposal = JSON.parse(proposed.stdout).proposal;
    await mutateProvider(fixture, (provider) => {
      provider.ambiguousCreateFailures = [proposal.items[0].eventId];
      provider.eventCreateFailures = [proposal.items[1].eventId];
    });

    const first = await runPromote(fixture, proposal.id, "--json");
    const retry = await runPromote(fixture, proposal.id, "--json");
    const finalRetry = await runPromote(fixture, proposal.id, "--json");

    assert.equal(first.exitCode, 2, JSON.stringify(first));
    assert.equal(retry.exitCode, 0, JSON.stringify(retry));
    assert.equal(JSON.parse(retry.stdout).outcome, "promoted");
    assert.equal(JSON.parse(retry.stdout).verifiedEvents.length, 3);
    assert.equal(finalRetry.exitCode, 0, JSON.stringify(finalRetry));
    assert.equal(JSON.parse(finalRetry.stdout).outcome, "retry");
    const provider = await readProvider(fixture);
    assert.equal(
      provider.requests.filter(({ method }) => method === "POST").length,
      4,
    );
    assert.equal(provider.events["academic-id"]?.length, 3);
    const journal = (
      await readFile(join(fixture.calendarRoot, "promotions.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(journal.length, 1);
    assert.equal(journal[0].eventIds.length, 3);
  });

  it("accepts Google-normalized defaults and recurrence order", async () => {
    const fixture = await setupFixture();
    const inputPath = join(fixture.inputRoot, "academic-timetable.json");
    await writeFile(
      inputPath,
      `${JSON.stringify({
        schemaVersion: 1,
        source: { kind: "ntu-timetable", reference: "private-image-2" },
        item: {
          operation: "academic-timetable",
          calendarRole: "Academic",
          term: "AY2026-27-S1",
          classes: [
            {
              key: "cc0006-mon-t004",
              summary: "CC0006 TUT T004",
              weekday: "MO",
              startTime: "09:30",
              endTime: "11:20",
              weeks: { from: 1, to: 13 },
              location: "COLLAB 2",
            },
          ],
          exams: [],
        },
      })}\n`,
    );
    const proposed = await runCalendarPropose(fixture, inputPath, "--json");
    assert.equal(proposed.exitCode, 0, JSON.stringify(proposed));
    const proposal = JSON.parse(proposed.stdout).proposal;
    const item = proposal.items[0];
    const normalized: Record<string, unknown> = {
      id: item.eventId,
      ...item.intendedEvent,
      extendedProperties: {
        private: { academicOsIdempotencyKey: item.idempotencyKey },
      },
      recurrence: [...(item.intendedEvent.recurrence ?? [])].reverse(),
    };
    delete normalized.transparency;
    await mutateProvider(fixture, (provider) => {
      provider.events["academic-id"] = [normalized];
      provider.incrementalEvents["academic-id"] = {
        "academic-sync": [normalized],
      };
    });

    const result = await runPromote(fixture, proposal.id, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "promoted");
    assert.equal(
      (await readProvider(fixture)).events["academic-id"]?.length,
      1,
    );
  });

  it("Refreshes, creates once, rereads, journals once, and Refreshes again", async () => {
    const fixture = await setupFixture();

    const first = await runPromote(fixture, "proposal-ready", "--json");
    const firstProvider = await readProvider(fixture);
    const retry = await runPromote(fixture, "proposal-ready", "--json");

    assert.equal(first.exitCode, 0, JSON.stringify(first));
    assert.equal(retry.exitCode, 0, JSON.stringify(retry));
    const report = JSON.parse(first.stdout);
    assert.equal(report.outcome, "promoted");
    assert.equal(report.proposalId, "proposal-ready");
    assert.equal(report.verifiedEvent.id, fixture.eventId);
    assert.equal(JSON.parse(retry.stdout).outcome, "retry");
    const firstWrite = firstProvider.requests.findIndex(
      ({ method }) => method !== "GET",
    );
    assert.ok(firstWrite >= 3);
    assert.ok(
      firstProvider.requests
        .slice(0, firstWrite)
        .every(({ method }) => method === "GET"),
    );
    assert.ok(
      firstProvider.requests
        .slice(firstWrite + 1)
        .some(
          ({ method, url }) =>
            method === "GET" && url.endsWith(`/events/${fixture.eventId}`),
        ),
    );
    assert.deepEqual(
      firstProvider.requests
        .slice(-3)
        .map(({ url }) => providerTarget(url, fixture.eventId)),
      ["Academic events", "Commitments events", "Routine events"],
    );

    const provider = await readProvider(fixture);
    const mutations = provider.requests.filter(
      ({ method }) => method !== "GET",
    );
    assert.equal(mutations.length, 1);
    assert.deepEqual(mutations[0], {
      body: {
        id: fixture.eventId,
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
        extendedProperties: {
          private: { academicOsIdempotencyKey: fixture.idempotencyKey },
        },
      },
      credential: fixture.writeCredential,
      method: "POST",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      url: "https://www.googleapis.com/calendar/v3/calendars/academic-id/events",
    });
    assert.ok(
      provider.requests.some(
        ({ method, url }) =>
          method === "GET" && url.endsWith(`/events/${fixture.eventId}`),
      ),
    );
    const journal = (
      await readFile(join(fixture.calendarRoot, "promotions.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(journal.length, 1);
    assert.equal(journal[0].proposalId, "proposal-ready");
    assert.equal(journal[0].eventId, fixture.eventId);
    assert.equal((await readProposal(fixture)).status, "promoted");
    const mirror = JSON.parse(
      await readFile(
        join(fixture.calendarRoot, "mirrors", "academic.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      mirror.items.map(({ event }: { event: { id: string } }) => event.id),
      [fixture.eventId],
    );
  });

  it("marks a Proposal stale when its target provider version changed", async () => {
    const fixture = await setupFixture();
    await mutateProvider(fixture, (provider) => {
      const calendar = provider.calendars[0];
      assert.ok(calendar);
      calendar.etag = "changed-version";
    });

    const result = await runPromote(fixture, "proposal-ready", "--json");

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "stale");
    assert.equal(
      (await readProposal(fixture)).staleReason,
      "live-version-changed",
    );
    assert.equal(
      (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      ).length,
      0,
    );
  });

  it("blocks before create when Refresh discovers a fixed conflict", async () => {
    const fixture = await setupFixture();
    await mutateProvider(fixture, (provider) => {
      const incremental = provider.incrementalEvents["academic-id"];
      assert.ok(incremental);
      incremental["academic-sync"] = [
        {
          id: "new-conflict",
          summary: "New live class",
          start: { dateTime: "2026-08-20T10:30:00+08:00" },
          end: { dateTime: "2026-08-20T11:30:00+08:00" },
        },
      ];
    });

    const result = await runPromote(fixture, "proposal-ready", "--json");

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "blocked");
    assert.equal(
      (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      ).length,
      0,
    );
  });

  it("blocks when pre-Promotion Refresh leaves relevant state stale", async () => {
    const fixture = await setupFixture();
    await mutateProvider(fixture, (provider) => {
      provider.eventReadFailures = ["academic-id"];
    });

    const result = await runPromote(fixture, "proposal-ready", "--json");

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "blocked");
    assert.equal(
      (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      ).length,
      0,
    );
  });

  it("recovers an ambiguous create by stable event ID without a duplicate", async () => {
    const fixture = await setupFixture();
    await mutateProvider(fixture, (provider) => {
      provider.ambiguousCreateFailures = [fixture.eventId];
    });

    const result = await runPromote(fixture, "proposal-ready", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "promoted");
    const provider = await readProvider(fixture);
    assert.equal(
      provider.requests.filter(({ method }) => method === "POST").length,
      1,
    );
    assert.equal(provider.events["academic-id"]?.length, 1);
  });

  for (const operation of ["create", "restore"] as const) {
    for (const ambiguous of [false, true]) {
      it(`refuses mismatched ${operation} readback after ${ambiguous ? "a lost" : "a successful"} response`, async () => {
        const mismatches = [
          { summary: "Unapproved title" },
          ...[
            "birthday",
            "focusTime",
            "fromGmail",
            "outOfOffice",
            "workingLocation",
            "unexpected-event-type",
          ].map((eventType) => ({ eventType })),
          { eventType: null },
          { unexpectedProviderField: "unapproved" },
          { visibility: "public" },
          { transparency: "transparent" },
          { description: "Unapproved description" },
          { location: "Unapproved location" },
          { recurrence: ["RRULE:FREQ=DAILY;COUNT=2"] },
          { start: { dateTime: "2026-08-21T10:00:00+08:00" } },
          { end: { dateTime: "2026-08-21T11:00:00+08:00" } },
          ...(operation === "restore"
            ? [
                { reminders: { useDefault: true } },
                { attachments: [] },
                { source: { url: "https://example.invalid/unapproved" } },
                { conferenceData: { entryPoints: [] } },
                { extendedProperties: { private: { custom: "changed" } } },
              ]
            : []),
        ];
        for (const mismatch of mismatches) {
          const fixture = await setupReadbackFixture(operation);
          await mutateProvider(fixture, (provider) => {
            provider.createdEventOverrides = { [fixture.eventId]: mismatch };
            if (ambiguous) provider.ambiguousCreateFailures = [fixture.eventId];
          });

          const result = await runPromote(fixture, "proposal-ready", "--json");

          assert.equal(
            result.exitCode,
            3,
            `${JSON.stringify(mismatch)}: ${JSON.stringify(result)}`,
          );
          assert.equal(JSON.parse(result.stdout).outcome, "blocked");
          assert.equal((await readProposal(fixture)).status, "ready");
          await assert.rejects(
            readFile(join(fixture.calendarRoot, "promotions.jsonl")),
            { code: "ENOENT" },
          );
          const provider = await readProvider(fixture);
          assert.equal(provider.events["academic-id"]?.length, 1);
          assert.partialDeepStrictEqual(
            provider.events["academic-id"]?.[0],
            mismatch,
          );
        }
      });
    }

    it(`accepts normalized ${operation} readback and retries without duplicates`, async () => {
      const fixture = await setupReadbackFixture(operation);
      await mutateProvider(fixture, (provider) => {
        provider.createdEventOverrides = {
          [fixture.eventId]: {
            eventType: "default",
            transparency: null,
            start: { dateTime: "2026-08-20T02:00:00Z" },
            end: { dateTime: "2026-08-20T03:00:00Z" },
            recurrence: [
              "EXDATE;TZID=Asia/Singapore:20260827T100000",
              "RRULE:FREQ=WEEKLY;COUNT=2",
            ],
          },
        };
        provider.ambiguousCreateFailures = [fixture.eventId];
      });

      const result = await runPromote(fixture, "proposal-ready", "--json");
      const retry = await runPromote(fixture, "proposal-ready", "--json");

      assert.equal(result.exitCode, 0, JSON.stringify(result));
      assert.equal(JSON.parse(result.stdout).outcome, "promoted");
      assert.equal(retry.exitCode, 0, JSON.stringify(retry));
      assert.equal(JSON.parse(retry.stdout).outcome, "retry");
      const provider = await readProvider(fixture);
      assert.equal(provider.events["academic-id"]?.length, 1);
      assert.equal(
        provider.requests.filter(({ method }) => method === "POST").length,
        1,
      );
      const journal = await readFile(
        join(fixture.calendarRoot, "promotions.jsonl"),
        "utf8",
      );
      assert.equal(journal.trim().split("\n").length, 1);
    });
  }

  it("reports equivalent human and JSON retry outcomes", async () => {
    const fixture = await setupFixture();
    await runPromote(fixture, "proposal-ready", "--json");

    const json = await runPromote(fixture, "proposal-ready", "--json");
    const human = await runPromote(fixture, "proposal-ready");

    assert.equal(human.exitCode, 0, JSON.stringify(human));
    const report = JSON.parse(json.stdout);
    assert.equal(human.stdout.split("\n")[0], "Calendar promote: retry");
    assert.equal(
      JSON.parse(
        human.stdout.split("\n")[2]?.replace("Verified event: ", "") ?? "null",
      ).id,
      report.verifiedEvent.id,
    );
  });

  it("reports equivalent promoted, stale, and blocked human and JSON outcomes", async () => {
    for (const outcome of ["promoted", "stale", "blocked"] as const) {
      const jsonFixture = await setupFixture();
      const humanFixture = await setupFixture();
      if (outcome === "stale") {
        for (const fixture of [jsonFixture, humanFixture]) {
          await mutateProvider(fixture, (provider) => {
            const calendar = provider.calendars[0];
            assert.ok(calendar);
            calendar.etag = "changed-version";
          });
        }
      }
      if (outcome === "blocked") {
        for (const fixture of [jsonFixture, humanFixture]) {
          await mutateProvider(fixture, (provider) => {
            provider.eventReadFailures = ["academic-id"];
          });
        }
      }
      const json = await runPromote(jsonFixture, "proposal-ready", "--json");
      const human = await runPromote(humanFixture, "proposal-ready");
      const report = JSON.parse(json.stdout);
      assert.equal(human.exitCode, json.exitCode);
      assert.equal(human.stdout.split("\n")[0], `Calendar promote: ${outcome}`);
      assert.equal(
        human.stdout.split("\n")[1],
        `Proposal ID: ${report.proposalId}`,
      );
    }
  });

  it("preserves an obsolete PID marker while recording a promotion receipt", async () => {
    const fixture = await setupFixture();
    await writeFile(
      join(fixture.calendarRoot, "promotions.jsonl.lock"),
      "2147483647\n",
    );

    const result = await runPromote(fixture, "proposal-ready", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "promoted");
    assert.equal(
      await readFile(
        join(fixture.calendarRoot, "promotions.jsonl.lock"),
        "utf8",
      ),
      "2147483647\n",
    );
  });

  it("does not report success when post-Refresh omits the verified event", async () => {
    const fixture = await setupFixture();
    await mutateProvider(fixture, (provider) => {
      provider.omitCreatedFromIncremental = true;
    });

    const result = await runPromote(fixture, "proposal-ready", "--json");

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "blocked");
    assert.equal((await readProposal(fixture)).status, "ready");

    const retry = await runPromote(fixture, "proposal-ready", "--json");
    assert.equal(retry.exitCode, 3, JSON.stringify(retry));
    assert.equal(JSON.parse(retry.stdout).outcome, "blocked");
    assert.equal((await readProposal(fixture)).status, "ready");
  });

  it("patches only intended fields, preserves provider data, and becomes stale after a live edit", async () => {
    const fixture = await setupChangeFixture("Academic");
    const first = await runPromote(fixture, "proposal-change", "--json");
    const retry = await runPromote(fixture, "proposal-change", "--json");

    assert.equal(first.exitCode, 0, JSON.stringify(first));
    assert.equal(JSON.parse(first.stdout).outcome, "promoted");
    assert.equal(JSON.parse(retry.stdout).outcome, "retry");
    const provider = await readProvider(fixture);
    const event = provider.events["academic-id"]?.[0] as Record<
      string,
      unknown
    >;
    assert.equal(event.summary, "Updated title");
    assert.equal(event.description, "Preserved description");
    assert.deepEqual(event.attendees, [{ email: "guest@example.com" }]);
    assert.deepEqual(event.reminders, {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 5 }],
    });
    const patches = provider.requests.filter(
      ({ method }) => method === "PATCH",
    );
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]?.body, { summary: "Updated title" });
  });

  it("promotes a recurrence patch when Google reorders recurrence lines", async () => {
    const recurrence = [
      "RRULE:FREQ=WEEKLY;UNTIL=20261109T155959Z",
      "EXDATE;TZID=Asia/Singapore:20260928T093000",
    ];
    const fixture = await setupChangeFixture(
      "Academic",
      { recurrence },
      { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"] },
    );
    await mutateProvider(fixture, (provider) => {
      provider.reverseRecurrenceOnPatch = ["owned-event"];
    });

    const result = await runPromote(fixture, "proposal-change", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "promoted");
    const promotedEvent = (await readProvider(fixture)).events[
      "academic-id"
    ]?.[0] as { recurrence?: unknown };
    assert.deepEqual(promotedEvent.recurrence, [...recurrence].reverse());
  });

  it("verifies a migrated series when Google reorders its recurrence lines", async () => {
    const recurrence = [
      "RRULE:FREQ=DAILY;UNTIL=20261109T155959Z",
      "EXDATE;TZID=Asia/Singapore:20260928T230000",
    ];
    const fixture = await setupRoutineMigrationFixture(recurrence);
    await mutateProvider(fixture, (provider) => {
      provider.reverseRecurrenceOnPatch = ["sleep-series"];
    });

    const result = await runPromote(
      fixture,
      "proposal-routine-migration",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "promoted");
  });

  it("marks an update Proposal stale when Refresh finds a provider change", async () => {
    const fixture = await setupChangeFixture("Academic");
    await mutateProvider(fixture, (provider) => {
      const incremental = provider.incrementalEvents["academic-id"];
      assert.ok(incremental);
      incremental["academic-sync"] = [
        {
          ...(provider.events["academic-id"]?.[0] as Record<string, unknown>),
          description: "Changed live after preparation",
        },
      ];
    });
    const result = await runPromote(fixture, "proposal-change", "--json");
    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "stale");
    assert.equal(
      (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      ).length,
      0,
    );
  });

  it("moves by exact configured IDs, journals once, and is safe to retry", async () => {
    const fixture = await setupChangeFixture("Routine");
    const first = await runPromote(fixture, "proposal-change", "--json");
    const retry = await runPromote(fixture, "proposal-change", "--json");

    assert.equal(first.exitCode, 0, JSON.stringify(first));
    assert.equal(JSON.parse(first.stdout).outcome, "promoted");
    assert.equal(JSON.parse(retry.stdout).outcome, "retry");
    const provider = await readProvider(fixture);
    assert.equal(provider.events["academic-id"]?.length, 0);
    assert.equal(provider.events["routine-id"]?.length, 1);
    const moves = provider.requests.filter(({ url }) => url.endsWith("/move"));
    assert.equal(moves.length, 1);
    assert.equal(
      moves[0]?.url,
      "https://www.googleapis.com/calendar/v3/calendars/academic-id/events/owned-event/move",
    );
    assert.deepEqual(moves[0]?.params, { destination: "routine-id" });
    const journal = (
      await readFile(join(fixture.calendarRoot, "promotions.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    assert.equal(journal.length, 1);
  });

  it("promotes one complete Routine migration, preserves exceptions, verifies, and retries safely", async () => {
    const fixture = await setupRoutineMigrationFixture();

    const first = await runPromote(
      fixture,
      "proposal-routine-migration",
      "--json",
    );
    const retry = await runPromote(
      fixture,
      "proposal-routine-migration",
      "--json",
    );

    assert.equal(first.exitCode, 0, JSON.stringify(first));
    assert.equal(JSON.parse(first.stdout).outcome, "promoted");
    assert.equal(JSON.parse(retry.stdout).outcome, "retry");
    const migrationInputPath = join(
      fixture.calendarRoot,
      "routine-migration-input.json",
    );
    await writeFile(
      migrationInputPath,
      `${JSON.stringify({
        schemaVersion: 1,
        source: {
          kind: "routine-migration",
          reference: "reviewed-2026-08",
        },
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
          ],
        },
      })}\n`,
    );
    const repeated = await runRoutineMigrationPropose(
      fixture,
      migrationInputPath,
      "--json",
    );
    assert.equal(repeated.exitCode, 0, JSON.stringify(repeated));
    assert.deepEqual(JSON.parse(repeated.stdout).proposal.moves, []);
    assert.deepEqual(
      JSON.parse(repeated.stdout).proposal.completed.map(
        ({ providerIdentity }: { providerIdentity: { eventId: string } }) =>
          providerIdentity.eventId,
      ),
      ["sleep-series", "exercise-series"],
    );
    assert.deepEqual(
      JSON.parse(first.stdout).verifiedEvents.map(
        ({ id }: { id: string }) => id,
      ),
      ["sleep-series", "exercise-series"],
    );
    const provider = await readProvider(fixture);
    assert.deepEqual(
      provider.events["academic-id"]?.map(
        (event) => (event as { id: string }).id,
      ),
      [],
    );
    assert.deepEqual(
      provider.events["routine-id"]?.map(
        (event) => (event as { id: string }).id,
      ),
      ["sleep-series", "sleep-exception", "exercise-series"],
    );
    const movedSleep = provider.events["routine-id"]?.find(
      (event) => (event as { id: string }).id === "sleep-series",
    ) as Record<string, unknown>;
    assert.deepEqual(movedSleep.recurrence, ["RRULE:FREQ=DAILY"]);
    assert.equal(movedSleep.transparency, "transparent");
    const movedException = provider.events["routine-id"]?.find(
      (event) => (event as { id: string }).id === "sleep-exception",
    ) as Record<string, unknown>;
    assert.equal(movedException.description, "Preserved exception");
    assert.equal(
      provider.requests.filter(({ url }) => url.endsWith("/move")).length,
      2,
    );
    const journal = (
      await readFile(join(fixture.calendarRoot, "promotions.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(journal.length, 1);
    assert.deepEqual(journal[0].eventIds, ["sleep-series", "exercise-series"]);
  });

  it("reconciles a move accepted before its patch could run", async () => {
    const fixture = await setupChangeFixture("Routine", {
      summary: "Moved and renamed",
    });
    await mutateProvider(fixture, (provider) => {
      provider.patchFailures = ["owned-event"];
    });
    const interrupted = await runPromote(fixture, "proposal-change", "--json");
    assert.equal(interrupted.exitCode, 2, JSON.stringify(interrupted));
    const retry = await runPromote(fixture, "proposal-change", "--json");
    assert.equal(retry.exitCode, 0, JSON.stringify(retry));
    assert.equal(JSON.parse(retry.stdout).outcome, "promoted");
    const provider = await readProvider(fixture);
    const movedEvent = provider.events["routine-id"]?.[0];
    assert.ok(movedEvent);
    assert.equal(
      (movedEvent as Record<string, unknown>).summary,
      "Moved and renamed",
    );
    assert.equal(
      provider.requests.filter(({ url }) => url.endsWith("/move")).length,
      1,
    );
  });

  it("promotes occurrence, entire-series, and this-and-future scopes distinctly", async () => {
    for (const scope of [
      "this-occurrence",
      "entire-series",
      "this-and-future",
    ] as const) {
      const fixture = await setupRecurringChangeFixture(scope);
      const result = await runPromote(fixture, "proposal-recurring", "--json");
      assert.equal(
        result.exitCode,
        0,
        `${scope}: ${JSON.stringify(result)} provider=${JSON.stringify(await readProvider(fixture))}`,
      );
      const mutations = (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      );
      if (scope === "this-occurrence") {
        assert.deepEqual(
          mutations.map(({ method, url }) => ({ method, url })),
          [
            {
              method: "PATCH",
              url: "https://www.googleapis.com/calendar/v3/calendars/academic-id/events/weekly-class-instance",
            },
          ],
        );
      } else if (scope === "entire-series") {
        assert.deepEqual(
          mutations.map(({ method, url }) => ({ method, url })),
          [
            {
              method: "PATCH",
              url: "https://www.googleapis.com/calendar/v3/calendars/academic-id/events/weekly-class",
            },
          ],
        );
      } else {
        assert.deepEqual(
          mutations.map(({ method }) => method),
          ["PATCH", "DELETE", "DELETE", "POST", "PATCH"],
        );
        const provider = await readProvider(fixture);
        const preservedException = provider.events["academic-id"]?.find(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "description" in event &&
            event.description === "Preserved exception description",
        );
        assert.ok(preservedException);
        const replacementSeries = provider.events["academic-id"]?.find(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "recurrence" in event &&
            Array.isArray(event.recurrence) &&
            event.recurrence.includes("RRULE:FREQ=WEEKLY;COUNT=3"),
        );
        assert.ok(replacementSeries);
      }
    }
  });

  it("retries this-and-future after the master was trimmed before replacement creation", async () => {
    const fixture = await setupRecurringChangeFixture("this-and-future");
    const proposal = JSON.parse(
      await readFile(
        join(fixture.calendarRoot, "pending-proposals.json"),
        "utf8",
      ),
    ).proposals[0];
    const replacementId = `a${crypto.createHash("sha256").update(proposal.idempotencyKey).digest("hex").slice(0, 31)}`;
    await mutateProvider(fixture, (provider) => {
      provider.eventCreateFailures = [replacementId];
    });
    const interrupted = await runPromote(
      fixture,
      "proposal-recurring",
      "--json",
    );
    assert.equal(interrupted.exitCode, 2, JSON.stringify(interrupted));
    const retry = await runPromote(fixture, "proposal-recurring", "--json");
    assert.equal(retry.exitCode, 0, JSON.stringify(retry));
    assert.equal(JSON.parse(retry.stdout).outcome, "promoted");
    const provider = await readProvider(fixture);
    assert.equal(
      provider.requests.filter(
        ({ method, url }) =>
          method === "PATCH" && url.endsWith("/events/weekly-class"),
      ).length,
      1,
    );
    assert.equal(
      provider.events["academic-id"]?.filter(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "id" in event &&
          event.id === replacementId,
      ).length,
      1,
    );
  });

  it("recovers a trimmed split when its bound occurrence and future exceptions disappear", async () => {
    for (const targetRole of ["Academic", "Routine"] as const) {
      const fixture = await setupRecurringChangeFixture(
        "this-and-future",
        targetRole,
      );
      const proposal = JSON.parse(
        await readFile(
          join(fixture.calendarRoot, "pending-proposals.json"),
          "utf8",
        ),
      ).proposals[0];
      const replacementId = `a${crypto.createHash("sha256").update(proposal.idempotencyKey).digest("hex").slice(0, 31)}`;
      await mutateProvider(fixture, (provider) => {
        provider.eventCreateFailures = [replacementId];
      });
      const interrupted = await runPromote(
        fixture,
        "proposal-recurring",
        "--json",
      );
      assert.equal(interrupted.exitCode, 2, JSON.stringify(interrupted));
      const syncToken = JSON.parse(
        await readFile(
          join(fixture.calendarRoot, "mirrors", "academic.json"),
          "utf8",
        ),
      ).syncToken;
      await mutateProvider(fixture, (provider) => {
        const master = provider.events["academic-id"]?.find(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "id" in event &&
            event.id === "weekly-class",
        ) as Record<string, unknown>;
        master.etag = "after-trim";
        master.updated = "2026-08-20T00:00:00Z";
        master.sequence = 1;
        provider.events["academic-id"] = [master];
        provider.incrementalEvents["academic-id"] ??= {};
        provider.incrementalEvents["academic-id"][syncToken] = [
          master,
          { id: "weekly-class-instance", status: "cancelled" },
          { id: "weekly-class-future-exception", status: "cancelled" },
        ];
      });
      const retry = await runPromote(fixture, "proposal-recurring", "--json");
      assert.equal(retry.exitCode, 0, JSON.stringify(retry));
      assert.equal(JSON.parse(retry.stdout).outcome, "promoted");
      const provider = await readProvider(fixture);
      const calendarId =
        targetRole === "Academic" ? "academic-id" : "routine-id";
      assert.ok(
        provider.events[calendarId]?.some(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "id" in event &&
            event.id === replacementId,
        ),
      );
      assert.equal(
        provider.events[calendarId]?.filter(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "recurringEventId" in event &&
            event.recurringEventId === replacementId,
        ).length,
        1,
      );
    }
  });

  it("refuses a split snapshot that differs from its bound source version", async () => {
    const fixture = await setupRecurringChangeFixture("this-and-future");
    const path = join(fixture.calendarRoot, "pending-proposals.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    state.proposals[0].recurringOccurrence.start.dateTime =
      "2026-08-20T15:00:00+08:00";
    await writeFile(path, `${JSON.stringify(state)}\n`);
    const result = await runPromote(fixture, "proposal-recurring", "--json");
    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "stale");
    assert.equal(
      (await readProvider(fixture)).requests.some(
        (request) => request.method !== "GET",
      ),
      false,
    );
  });

  it("reconciles an interrupted this-and-future move by replacement ID", async () => {
    const fixture = await setupRecurringChangeFixture(
      "this-and-future",
      "Routine",
    );
    await mutateProvider(fixture, (provider) => {
      provider.patchFailures = ["*"];
    });
    const first = await runPromote(fixture, "proposal-recurring", "--json");
    assert.equal(first.exitCode, 2, JSON.stringify(first));
    const retry = await runPromote(fixture, "proposal-recurring", "--json");
    assert.equal(retry.exitCode, 0, JSON.stringify(retry));
    assert.equal(JSON.parse(retry.stdout).outcome, "promoted");
    const provider = await readProvider(fixture);
    assert.equal(provider.events["routine-id"]?.length, 2);
  });

  it("stales this-and-future when a bound future exception changes", async () => {
    const fixture = await setupRecurringChangeFixture("this-and-future");
    await mutateProvider(fixture, (provider) => {
      const exception = provider.events["academic-id"]?.find(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "id" in event &&
          event.id === "weekly-class-future-exception",
      );
      const incremental = provider.incrementalEvents["academic-id"];
      assert.ok(exception);
      assert.ok(incremental);
      incremental["academic-sync"] = [
        {
          ...(exception as Record<string, unknown>),
          description: "Changed after preparation",
        },
      ];
    });
    const result = await runPromote(fixture, "proposal-recurring", "--json");
    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "stale");
    assert.equal(
      (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      ).length,
      0,
    );
  });

  it("stales an entire-series occurrence when its bound master changes", async () => {
    const fixture = await setupRecurringChangeFixture(
      "entire-series",
      "Academic",
      true,
    );
    await mutateProvider(fixture, (provider) => {
      const master = provider.events["academic-id"]?.find(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "id" in event &&
          event.id === "weekly-class",
      );
      const incremental = provider.incrementalEvents["academic-id"];
      assert.ok(master);
      assert.ok(incremental);
      incremental["academic-sync"] = [
        {
          ...(master as Record<string, unknown>),
          description: "Changed after preparation",
        },
      ];
    });

    const result = await runPromote(fixture, "proposal-recurring", "--json");

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "stale");
    assert.equal(
      (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      ).length,
      0,
    );
  });

  it("cancels exactly once, retains a tombstone, retries safely, and explicitly restores", async () => {
    const fixture = await setupCancellationFixture();

    const cancelled = await runPromote(fixture, "proposal-cancel", "--json");
    const retry = await runPromote(fixture, "proposal-cancel", "--json");

    assert.equal(cancelled.exitCode, 0, JSON.stringify(cancelled));
    assert.equal(JSON.parse(cancelled.stdout).outcome, "promoted");
    assert.equal(JSON.parse(retry.stdout).outcome, "retry");
    let provider = await readProvider(fixture);
    assert.equal(
      provider.requests.filter(({ method }) => method === "DELETE").length,
      1,
    );
    const mirrorPath = join(fixture.calendarRoot, "mirrors", "academic.json");
    const mirror = JSON.parse(await readFile(mirrorPath, "utf8"));
    assert.equal(mirror.items.length, 0);
    assert.equal(mirror.tombstones[0].event.summary, "Original title");

    await writeFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        proposals: [
          {
            id: "proposal-restore",
            status: "ready",
            operation: "restore",
            source: { kind: "instruction", reference: "restore-owned-event" },
            itemKind: "fixed-event",
            target: { calendarRole: "Academic", calendarId: "academic-id" },
            intendedEvent: { ...mirror.tombstones[0].event },
            restoredFrom: {
              calendarRole: "Academic",
              eventId: "owned-event",
              deletedAt: mirror.tombstones[0].deletedAt,
            },
            idempotencyKey: "restore-owned-event",
            liveVersions: [],
            relevantAvailabilityVersion: {
              digest: calendarStateDigest([]),
              interval: null,
              checkedCalendarCount: 0,
            },
            conflictSummary: { blockers: 0, warnings: 0 },
          },
        ],
      })}\n`,
    );
    await reviewCalendarProposalFixture(fixture);
    const restored = await runPromote(fixture, "proposal-restore", "--json");
    const restoreRetry = await runPromote(
      fixture,
      "proposal-restore",
      "--json",
    );
    assert.equal(restored.exitCode, 0, JSON.stringify(restored));
    assert.equal(JSON.parse(restored.stdout).outcome, "promoted");
    assert.equal(JSON.parse(restoreRetry.stdout).outcome, "retry");
    provider = await readProvider(fixture);
    assert.equal(
      provider.requests.filter(({ method }) => method === "POST").length,
      1,
    );
  });

  it("honours manual deletion precedence without issuing another delete", async () => {
    const fixture = await setupCancellationFixture();
    await mutateProvider(fixture, (provider) => {
      provider.events["academic-id"] = [];
      provider.incrementalEvents["academic-id"] ??= {};
      provider.incrementalEvents["academic-id"]["academic-sync"] = [
        { id: "owned-event", status: "cancelled" },
      ];
    });

    const result = await runPromote(fixture, "proposal-cancel", "--json");

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "stale");
    assert.equal(
      (await readProvider(fixture)).requests.filter(
        ({ method }) => method === "DELETE",
      ).length,
      0,
    );
  });

  for (const legacy of [false, true]) {
    it(`restores ${legacy ? "legacy" : "new"} writable metadata with a new identity and idempotency marker`, async () => {
      const fixture = await setupReadbackFixture("restore");
      const mirrorPath = join(fixture.calendarRoot, "mirrors", "academic.json");
      const mirror = JSON.parse(await readFile(mirrorPath, "utf8"));
      const providerFields = {
        etag: "old-etag",
        created: "2026-08-01T00:00:00Z",
        updated: "2026-08-19T00:00:00Z",
        creator: { self: true },
        htmlLink: "https://calendar.google.com/old-event",
        iCalUID: "old-event@example.invalid",
        kind: "calendar#event",
        hangoutLink: "https://meet.google.com/old-event",
        locked: false,
      };
      const writable = {
        source: {
          url: "https://example.invalid/source",
          title: "Approved source",
        },
        conferenceData: {
          entryPoints: [
            {
              entryPointType: "video",
              uri: "https://example.invalid/conference",
            },
          ],
        },
        extendedProperties: {
          private: {
            academicOsIdempotencyKey: "old-create",
            custom: "retained",
          },
          shared: { reference: "retained-shared" },
        },
      };
      mirror.tombstones[0].event = {
        ...mirror.tombstones[0].event,
        ...providerFields,
        ...writable,
      };
      await writeFile(mirrorPath, `${JSON.stringify(mirror)}\n`);
      const inputPath = join(fixture.inputRoot, "restore.json");
      await writeFile(
        inputPath,
        `${JSON.stringify({
          schemaVersion: 1,
          source: { kind: "instruction", reference: "restore-metadata" },
          item: {
            operation: "restore",
            calendarRole: "Academic",
            eventId: "deleted-event",
          },
        })}\n`,
      );
      const proposed = await runCalendarPropose(fixture, inputPath, "--json");
      assert.equal(proposed.exitCode, 0, JSON.stringify(proposed));
      const proposal = JSON.parse(proposed.stdout).proposal;
      if (legacy) {
        proposal.intendedEvent = {
          ...proposal.intendedEvent,
          ...providerFields,
          ...writable,
        };
        await writeFile(
          join(fixture.calendarRoot, "pending-proposals.json"),
          `${JSON.stringify({ schemaVersion: 1, proposals: [proposal] })}\n`,
        );
      }

      const result = await runPromote(fixture, proposal.id, "--json");

      const provider = await readProvider(fixture);
      if (legacy) {
        assert.equal(result.exitCode, 3, JSON.stringify(result));
        assert.equal(JSON.parse(result.stdout).outcome, "stale");
        assert.equal(
          provider.requests.some(({ method }) => method !== "GET"),
          false,
        );
        return;
      }
      const expected = {
        ...writable,
        extendedProperties: {
          ...writable.extendedProperties,
          private: {
            ...writable.extendedProperties.private,
            academicOsIdempotencyKey: proposal.idempotencyKey,
          },
        },
      };
      assert.partialDeepStrictEqual(
        provider.events["academic-id"]?.[0],
        expected,
      );
      assert.equal(result.exitCode, 0, JSON.stringify(result));
      assert.equal(JSON.parse(result.stdout).outcome, "promoted");
      const created = provider.requests.find(({ method }) => method === "POST");
      assert.ok(created?.body !== null && typeof created?.body === "object");
      for (const key of ["id", ...Object.keys(providerFields)]) {
        if (!legacy)
          assert.equal(Reflect.has(proposal.intendedEvent, key), false, key);
        if (key !== "id")
          assert.equal(Reflect.has(created.body, key), false, key);
      }
      assert.deepEqual(created.params, {
        supportsAttachments: true,
        conferenceDataVersion: 1,
      });
      const retry = await runPromote(fixture, proposal.id, "--json");
      assert.equal(retry.exitCode, 0, JSON.stringify(retry));
      assert.equal(JSON.parse(retry.stdout).outcome, "retry");
      assert.equal(
        (await readProvider(fixture)).events["academic-id"]?.length,
        1,
      );
    });
  }

  it("promotes each explicit recurring cancellation scope", async () => {
    for (const scope of [
      "this-occurrence",
      "entire-series",
      "this-and-future",
    ] as const) {
      const fixture = await setupRecurringChangeFixture(scope);
      const statePath = join(fixture.calendarRoot, "pending-proposals.json");
      const state = JSON.parse(await readFile(statePath, "utf8"));
      const change = state.proposals[0];
      const provider = await readProvider(fixture);
      const events = provider.events["academic-id"] ?? [];
      const proposal = {
        ...change,
        operation: "cancel",
        preview: {
          event:
            scope === "entire-series"
              ? (change.recurringMaster ?? events[0])
              : events[1],
          recurrenceScope: scope,
        },
        target: { calendarRole: "Academic", calendarId: "academic-id" },
      };
      delete proposal.patch;
      delete proposal.recurrenceExceptions;
      await writeFile(
        statePath,
        `${JSON.stringify({ schemaVersion: 1, proposals: [proposal] })}\n`,
      );

      await reviewCalendarProposalFixture(fixture);
      const result = await runPromote(fixture, "proposal-recurring", "--json");
      assert.equal(result.exitCode, 0, `${scope}: ${JSON.stringify(result)}`);
      const mutations = (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      );
      assert.equal(
        mutations[0]?.method,
        scope === "this-and-future" ? "PATCH" : "DELETE",
      );
      if (scope === "this-and-future") {
        assert.partialDeepStrictEqual(
          (await readProvider(fixture)).events["academic-id"]?.[0],
          { recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20260820T015959Z"] },
        );
        const retry = await runPromote(fixture, "proposal-recurring", "--json");
        assert.equal(retry.exitCode, 0, JSON.stringify(retry));
        assert.equal(JSON.parse(retry.stdout).outcome, "retry");
        assert.equal(
          (await readProvider(fixture)).requests.filter(
            ({ method }) => method === "PATCH",
          ).length,
          1,
        );
        const journal = await readFile(
          join(fixture.calendarRoot, "promotions.jsonl"),
          "utf8",
        );
        assert.equal(journal.trim().split("\n").length, 1);
      }
    }
  });

  it("refuses a future cancellation when the provider accepts but ignores the trim", async () => {
    const fixture = await setupRecurringChangeFixture("this-and-future");
    const statePath = join(fixture.calendarRoot, "pending-proposals.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const change = state.proposals[0];
    const before = await readProvider(fixture);
    const occurrence = before.events["academic-id"]?.[1];
    const proposal = {
      ...change,
      operation: "cancel",
      preview: { event: occurrence, recurrenceScope: "this-and-future" },
    };
    delete proposal.patch;
    delete proposal.recurrenceExceptions;
    await writeFile(
      statePath,
      `${JSON.stringify({ schemaVersion: 1, proposals: [proposal] })}\n`,
    );
    await reviewCalendarProposalFixture(fixture);
    await mutateProvider(fixture, (provider) => {
      provider.ignoredPatches = ["weekly-class"];
    });

    const result = await runPromote(fixture, "proposal-recurring", "--json");

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "blocked");
    assert.equal((await readProposal(fixture)).status, "ready");
    const provider = await readProvider(fixture);
    assert.deepEqual(provider.events, before.events);
    assert.equal(
      provider.requests.filter(({ method }) => method === "PATCH").length,
      1,
    );
    await assert.rejects(
      readFile(join(fixture.calendarRoot, "promotions.jsonl")),
      { code: "ENOENT" },
    );
    const mirror = JSON.parse(
      await readFile(
        join(fixture.calendarRoot, "mirrors", "academic.json"),
        "utf8",
      ),
    );
    assert.deepEqual(mirror.tombstones, []);
    assert.ok(
      mirror.items.some(
        ({ event }: { event: { id: string } }) =>
          event.id === "weekly-class-instance",
      ),
    );
  });
});

interface Fixture {
  calendarRoot: string;
  configPath: string;
  eventId: string;
  idempotencyKey: string;
  inputRoot: string;
  providerPath: string;
  writeCredential: string;
}

function providerTarget(url: string, eventId: string): string {
  if (url.endsWith("/users/me/calendarList")) return "Calendar list";
  if (url.endsWith(`/events/${eventId}`)) return "Verified event";
  if (url.includes("/calendars/academic-id/events")) return "Academic events";
  if (url.includes("/calendars/commitments-id/events")) {
    return "Commitments events";
  }
  if (url.includes("/calendars/routine-id/events")) return "Routine events";
  if (url.includes("/calendars/observed-id/events")) return "Observed events";
  return url;
}

async function setupFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-calendar-promote-"));
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
  const readCredential = join(root, "calendar-read.credentials.json");
  const writeCredential = join(root, "calendar-write.credentials.json");
  const configPath = join(root, "academic-os.config.json");
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
        syncQuery: { singleEvents: false, showDeleted: true },
        items: [],
        tombstones: [],
      })}\n`,
    );
  }
  const idempotencyKey = `create-${"a".repeat(64)}`;
  const eventId = `a${crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 31)}`;
  await writeFile(
    join(calendarRoot, "pending-proposals.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      proposals: [
        {
          id: "proposal-ready",
          status: "ready",
          operation: "create",
          source: { kind: "instruction", reference: "private-request" },
          itemKind: "fixed-event",
          target: { calendarRole: "Academic", calendarId: "academic-id" },
          intendedEvent: {
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
          },
          inheritedDefaults: { calendarColorId: null, reminders: [] },
          targetCalendarVersion: {
            calendarId: "academic-id",
            etag: "academic-version",
          },
          idempotencyKey,
          liveVersions: [],
          relevantAvailabilityVersion: {
            digest:
              "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
            interval: {
              start: "2026-08-20T02:00:00.000Z",
              end: "2026-08-20T03:00:00.000Z",
            },
            checkedCalendarCount: 4,
          },
          conflictSummary: { blockers: 0, warnings: 0 },
        },
      ],
    })}\n`,
  );
  const providerPath = join(root, "provider.json");
  await writeFile(
    providerPath,
    `${JSON.stringify({
      calendars: [
        {
          id: "academic-id",
          summary: "Personal",
          accessRole: "owner",
          primary: true,
          selected: true,
          timeZone: "Asia/Singapore",
          etag: "academic-version",
        },
        {
          id: "commitments-id",
          summary: "Commitments",
          accessRole: "owner",
          selected: true,
          timeZone: "Asia/Singapore",
        },
        {
          id: "routine-id",
          summary: "Routine",
          accessRole: "owner",
          selected: true,
          timeZone: "Asia/Singapore",
        },
        {
          id: "observed-id",
          summary: "Observed",
          accessRole: "reader",
          selected: true,
          timeZone: "Asia/Singapore",
        },
      ],
      events: {
        "academic-id": [],
        "commitments-id": [],
        "routine-id": [],
        "observed-id": [],
      },
      incrementalEvents: {
        "academic-id": { "academic-sync": [] },
        "commitments-id": { "commitments-sync": [] },
        "routine-id": { "routine-sync": [] },
      },
    })}\n`,
  );
  const fixture = {
    calendarRoot,
    configPath,
    eventId,
    idempotencyKey,
    inputRoot,
    providerPath,
    writeCredential,
  };
  await reviewCalendarProposalFixture(fixture);
  return fixture;
}

async function setupReadbackFixture(
  operation: "create" | "restore",
): Promise<Fixture> {
  const fixture = await setupFixture();
  const statePath = join(fixture.calendarRoot, "pending-proposals.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const proposal = state.proposals[0];
  proposal.intendedEvent = {
    ...proposal.intendedEvent,
    description: "Approved description",
    location: "Approved location",
    recurrence: [
      "RRULE:FREQ=WEEKLY;COUNT=2",
      "EXDATE;TZID=Asia/Singapore:20260827T100000",
    ],
    ...(operation === "restore"
      ? {
          reminders: {
            useDefault: false,
            overrides: [{ method: "popup", minutes: 5 }],
          },
          attachments: [{ fileUrl: "https://example.invalid/approved" }],
          source: {
            url: "https://example.invalid/approved",
            title: "Approved source",
          },
          conferenceData: {
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://example.invalid/conference",
              },
            ],
          },
          extendedProperties: {
            private: {
              custom: "retained",
              academicOsIdempotencyKey: fixture.idempotencyKey,
            },
            shared: { reference: "retained-shared" },
          },
        }
      : {}),
  };
  if (operation === "restore") {
    proposal.operation = "restore";
    delete proposal.inheritedDefaults;
    delete proposal.targetCalendarVersion;
    proposal.restoredFrom = {
      calendarRole: "Academic",
      eventId: "deleted-event",
      deletedAt: "2026-08-19T20:00:00.000Z",
    };
    const mirrorPath = join(fixture.calendarRoot, "mirrors", "academic.json");
    const mirror = JSON.parse(await readFile(mirrorPath, "utf8"));
    mirror.tombstones = [
      {
        access: "owned",
        deletedAt: proposal.restoredFrom.deletedAt,
        event: { id: "deleted-event", ...proposal.intendedEvent },
      },
    ];
    await writeFile(mirrorPath, `${JSON.stringify(mirror)}\n`);
  }
  await writeFile(statePath, `${JSON.stringify(state)}\n`);
  await reviewCalendarProposalFixture(fixture);
  return fixture;
}

async function setupChangeFixture(
  targetRole: "Academic" | "Routine",
  patch: Record<string, unknown> = targetRole === "Academic"
    ? { summary: "Updated title" }
    : {},
  eventOverrides: Record<string, unknown> = {},
): Promise<Fixture> {
  const fixture = await setupFixture();
  const event = {
    id: "owned-event",
    etag: "event-version-1",
    summary: "Original title",
    description: "Preserved description",
    attendees: [{ email: "guest@example.com" }],
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 5 }],
    },
    visibility: "private",
    start: {
      dateTime: "2026-08-20T10:00:00+08:00",
      timeZone: "Asia/Singapore",
    },
    end: { dateTime: "2026-08-20T11:00:00+08:00", timeZone: "Asia/Singapore" },
    ...eventOverrides,
  };
  const academicMirrorPath = join(
    fixture.calendarRoot,
    "mirrors",
    "academic.json",
  );
  const academicMirror = JSON.parse(await readFile(academicMirrorPath, "utf8"));
  academicMirror.items = [
    { actualCalendarRole: "Academic", access: "owned", event },
  ];
  await writeFile(academicMirrorPath, `${JSON.stringify(academicMirror)}\n`);
  await writeFile(
    join(fixture.calendarRoot, "pending-proposals.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      proposals: [
        {
          id: "proposal-change",
          status: "ready",
          operation: targetRole === "Academic" ? "update" : "move",
          source: { kind: "instruction", reference: "change-owned-event" },
          itemKind: "fixed-event",
          sourceItem: {
            calendarRole: "Academic",
            calendarId: "academic-id",
            eventId: "owned-event",
            versionDigest: calendarStateDigest(event),
          },
          target: {
            calendarRole: targetRole,
            calendarId:
              targetRole === "Academic" ? "academic-id" : "routine-id",
          },
          patch,
          ...(eventOverrides.recurrence === undefined
            ? {}
            : { recurrenceScope: "entire-series" }),
          idempotencyKey: `change-${targetRole}`,
          liveVersions: [],
          relevantAvailabilityVersion: {
            digest: calendarStateDigest([]),
            interval: null,
            checkedCalendarCount: 0,
          },
          conflictSummary: { blockers: 0, warnings: 0 },
        },
      ],
    })}\n`,
  );
  await mutateProvider(fixture, (provider) => {
    provider.events["academic-id"] = [event];
  });
  await reviewCalendarProposalFixture(fixture);
  return fixture;
}

async function setupCancellationFixture(): Promise<Fixture> {
  const fixture = await setupChangeFixture("Academic");
  const mirror = JSON.parse(
    await readFile(
      join(fixture.calendarRoot, "mirrors", "academic.json"),
      "utf8",
    ),
  );
  const event = mirror.items[0].event;
  await writeFile(
    join(fixture.calendarRoot, "pending-proposals.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      proposals: [
        {
          id: "proposal-cancel",
          status: "ready",
          operation: "cancel",
          source: { kind: "instruction", reference: "cancel-owned-event" },
          itemKind: "fixed-event",
          sourceItem: {
            calendarRole: "Academic",
            calendarId: "academic-id",
            eventId: event.id,
            versionDigest: calendarStateDigest(event),
          },
          target: { calendarRole: "Academic", calendarId: "academic-id" },
          preview: { event },
          idempotencyKey: "cancel-owned-event",
          liveVersions: [],
          relevantAvailabilityVersion: {
            digest: calendarStateDigest([]),
            interval: null,
            checkedCalendarCount: 0,
          },
          conflictSummary: { blockers: 0, warnings: 0 },
        },
      ],
    })}\n`,
  );
  await reviewCalendarProposalFixture(fixture);
  return fixture;
}

async function setupRecurringChangeFixture(
  recurrenceScope: "this-occurrence" | "entire-series" | "this-and-future",
  targetRole: "Academic" | "Routine" = "Academic",
  selectOccurrenceForEntireSeries = false,
): Promise<Fixture> {
  const fixture = await setupFixture();
  const master = {
    id: "weekly-class",
    summary: "Weekly class",
    description: "Preserved series description",
    recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5"],
    start: {
      dateTime: "2026-08-06T10:00:00+08:00",
      timeZone: "Asia/Singapore",
    },
    end: { dateTime: "2026-08-06T11:00:00+08:00", timeZone: "Asia/Singapore" },
  };
  const instance = {
    id: "weekly-class-instance",
    recurringEventId: "weekly-class",
    originalStartTime: {
      dateTime: "2026-08-20T10:00:00+08:00",
      timeZone: "Asia/Singapore",
    },
    summary: "Weekly class",
    description: "Preserved instance description",
    start: {
      dateTime: "2026-08-20T10:00:00+08:00",
      timeZone: "Asia/Singapore",
    },
    end: { dateTime: "2026-08-20T11:00:00+08:00", timeZone: "Asia/Singapore" },
  };
  const exception = {
    ...instance,
    id: "weekly-class-future-exception",
    originalStartTime: {
      dateTime: "2026-08-27T10:00:00+08:00",
      timeZone: "Asia/Singapore",
    },
    start: {
      dateTime: "2026-08-27T12:00:00+08:00",
      timeZone: "Asia/Singapore",
    },
    end: { dateTime: "2026-08-27T13:00:00+08:00", timeZone: "Asia/Singapore" },
    description: "Preserved exception description",
    attachments: [{ fileUrl: "https://example.invalid/private" }],
  };
  const source =
    recurrenceScope === "entire-series" && !selectOccurrenceForEntireSeries
      ? master
      : instance;
  const mirrorPath = join(fixture.calendarRoot, "mirrors", "academic.json");
  const mirror = JSON.parse(await readFile(mirrorPath, "utf8"));
  mirror.items = [master, instance, exception].map((event) => ({
    actualCalendarRole: "Academic",
    access: "owned",
    event,
  }));
  await writeFile(mirrorPath, `${JSON.stringify(mirror)}\n`);
  await writeFile(
    join(fixture.calendarRoot, "pending-proposals.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      proposals: [
        {
          id: "proposal-recurring",
          status: "ready",
          operation: targetRole === "Academic" ? "update" : "move",
          source: { kind: "instruction", reference: recurrenceScope },
          itemKind: "fixed-event",
          sourceItem: {
            calendarRole: "Academic",
            calendarId: "academic-id",
            eventId: source.id,
            versionDigest: calendarStateDigest(source),
            ...("recurringEventId" in source
              ? { recurringEventId: source.recurringEventId }
              : {}),
          },
          target: {
            calendarRole: targetRole,
            calendarId:
              targetRole === "Academic" ? "academic-id" : "routine-id",
          },
          patch: { summary: `Changed ${recurrenceScope}` },
          recurrenceScope,
          ...(recurrenceScope === "this-and-future"
            ? {
                recurrenceExceptions: [exception],
                recurringMaster: master,
                recurringOccurrence: instance,
                recurrenceDependencies: [
                  {
                    eventId: master.id,
                    versionDigest: calendarStateDigest(master),
                    acceptedTrimmedDigest: calendarStateDigest({
                      ...master,
                      recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20260820T015959Z"],
                    }),
                  },
                  {
                    eventId: exception.id,
                    versionDigest: calendarStateDigest(exception),
                  },
                ],
              }
            : recurrenceScope === "entire-series" &&
                selectOccurrenceForEntireSeries
              ? {
                  recurrenceDependencies: [
                    {
                      eventId: master.id,
                      versionDigest: calendarStateDigest(master),
                    },
                  ],
                }
              : {}),
          idempotencyKey: `recurring-${recurrenceScope}`,
          liveVersions: [],
          relevantAvailabilityVersion: {
            digest: calendarStateDigest([]),
            interval: null,
            checkedCalendarCount: 0,
          },
          conflictSummary: { blockers: 0, warnings: 0 },
        },
      ],
    })}\n`,
  );
  await mutateProvider(fixture, (provider) => {
    provider.events["academic-id"] = [master, instance, exception];
  });
  await reviewCalendarProposalFixture(fixture);
  return fixture;
}

async function setupRoutineMigrationFixture(
  masterRecurrence: string[] = ["RRULE:FREQ=DAILY"],
): Promise<Fixture> {
  const fixture = await setupFixture();
  const master = {
    id: "sleep-series",
    summary: "Sleep",
    description: "Preserved series description",
    recurrence: masterRecurrence,
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
  const exception = {
    id: "sleep-exception",
    recurringEventId: "sleep-series",
    originalStartTime: {
      dateTime: "2026-08-20T23:00:00+08:00",
      timeZone: "Asia/Singapore",
    },
    summary: "Sleep",
    description: "Preserved exception",
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
  const moves = [
    {
      sourceItem: {
        calendarRole: "Academic",
        calendarId: "academic-id",
        eventId: master.id,
        versionDigest: calendarStateDigest(master),
      },
      target: { calendarRole: "Routine", calendarId: "routine-id" },
      patch: { transparency: "transparent" },
      recurrenceScope: "entire-series",
      recurringMaster: master,
      recurrenceExceptions: [exception],
      seriesEventIds: [master.id, exception.id],
    },
    {
      sourceItem: {
        calendarRole: "Academic",
        calendarId: "academic-id",
        eventId: exercise.id,
        versionDigest: calendarStateDigest(exercise),
      },
      target: { calendarRole: "Routine", calendarId: "routine-id" },
      patch: {},
      recurrenceScope: "entire-series",
      recurringMaster: exercise,
      recurrenceExceptions: [],
      seriesEventIds: [exercise.id],
    },
  ];
  const academicMirrorPath = join(
    fixture.calendarRoot,
    "mirrors",
    "academic.json",
  );
  const academicMirror = JSON.parse(await readFile(academicMirrorPath, "utf8"));
  academicMirror.items = [master, exception, exercise].map((event) => ({
    actualCalendarRole: "Academic",
    access: "owned",
    event,
  }));
  await writeFile(academicMirrorPath, `${JSON.stringify(academicMirror)}\n`);
  await writeFile(
    join(fixture.calendarRoot, "pending-proposals.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      proposals: [
        {
          id: "proposal-routine-migration",
          status: "ready",
          operation: "routine-migration",
          source: {
            kind: "routine-migration",
            reference: "reviewed-2026-08",
          },
          itemKind: "routine-event",
          target: { calendarRole: "Routine", calendarId: "routine-id" },
          moves,
          completed: [],
          decisions: [],
          idempotencyKey: "routine-migration-proposal",
          liveVersions: [],
          relevantAvailabilityVersion: {
            digest: calendarStateDigest([]),
            interval: null,
            checkedCalendarCount: 0,
          },
          conflictSummary: { blockers: 0, warnings: 0 },
        },
      ],
    })}\n`,
  );
  await mutateProvider(fixture, (provider) => {
    provider.events["academic-id"] = [master, exception, exercise];
  });
  await reviewCalendarProposalFixture(fixture);
  return fixture;
}

async function runPromote(
  fixture: Fixture,
  proposalId: string,
  ...arguments_: string[]
) {
  return await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_CALENDAR_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${fakeCalendarPreload}`,
    },
    "calendar",
    "promote",
    proposalId,
    "--config",
    fixture.configPath,
    ...arguments_,
  );
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

async function runRoutineMigrationPropose(
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

async function readProvider(fixture: Fixture): Promise<{
  ambiguousCreateFailures?: string[];
  calendars: Array<{ etag?: string }>;
  createdEventOverrides?: Record<string, Record<string, unknown>>;
  eventReadFailures?: string[];
  eventCreateFailures?: string[];
  events: Record<string, unknown[]>;
  incrementalEvents: Record<string, Record<string, unknown[]>>;
  ignoredPatches?: string[];
  omitCreatedFromIncremental?: boolean;
  reverseRecurrenceOnPatch?: string[];
  patchFailures?: string[];
  requests: Array<{
    body?: unknown;
    credential?: string;
    method: string;
    scopes?: string[];
    params?: unknown;
    url: string;
  }>;
}> {
  return JSON.parse(await readFile(fixture.providerPath, "utf8"));
}

async function mutateProvider(
  fixture: Fixture,
  mutate: (provider: Awaited<ReturnType<typeof readProvider>>) => void,
): Promise<void> {
  const provider = await readProvider(fixture);
  mutate(provider);
  for (const [calendarId, tokens] of Object.entries(
    provider.incrementalEvents,
  )) {
    const events = provider.events[calendarId] ?? [];
    for (const event of Object.values(tokens).flat()) {
      if (typeof event !== "object" || event === null || !("id" in event))
        continue;
      const index = events.findIndex(
        (current) =>
          typeof current === "object" &&
          current !== null &&
          "id" in current &&
          current.id === event.id,
      );
      if ("status" in event && event.status === "cancelled") {
        if (index >= 0) events.splice(index, 1);
      } else if (index >= 0) events[index] = event;
      else events.push(event);
    }
    provider.events[calendarId] = events;
  }
  await writeFile(fixture.providerPath, `${JSON.stringify(provider)}\n`);
}

async function readProposal(
  fixture: Fixture,
): Promise<{ staleReason?: string; status: string }> {
  const state = JSON.parse(
    await readFile(
      join(fixture.calendarRoot, "pending-proposals.json"),
      "utf8",
    ),
  );
  return state.proposals[0];
}
