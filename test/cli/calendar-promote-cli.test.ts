import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runCliWithEnvironment } from "../support/run-cli.js";
import { calendarStateDigest } from "../../src/calendar/index.js";

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
    assert.deepEqual(
      firstProvider.requests.map(({ method, url }) => ({
        method,
        target: providerTarget(url, fixture.eventId),
      })),
      [
        { method: "GET", target: "Academic events" },
        { method: "GET", target: "Commitments events" },
        { method: "GET", target: "Routine events" },
        { method: "GET", target: "Calendar list" },
        { method: "GET", target: "Observed events" },
        { method: "POST", target: "Academic events" },
        { method: "GET", target: "Verified event" },
        { method: "GET", target: "Academic events" },
        { method: "GET", target: "Commitments events" },
        { method: "GET", target: "Routine events" },
      ],
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

  it("reconciles an interrupted dead-owner journal lock", async () => {
    const fixture = await setupFixture();
    await writeFile(
      join(fixture.calendarRoot, "promotions.jsonl.lock"),
      "2147483647\n",
    );

    const result = await runPromote(fixture, "proposal-ready", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).outcome, "promoted");
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
          ["PUT", "POST", "PATCH"],
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
            event.recurrence.includes("RRULE:FREQ=WEEKLY;COUNT=4"),
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
      provider.requests.filter(({ method }) => method === "PUT").length,
      2,
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
            intendedEvent: {
              summary: "Original title",
              visibility: "private",
              start: mirror.tombstones[0].event.start,
              end: mirror.tombstones[0].event.end,
            },
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

      const result = await runPromote(fixture, "proposal-recurring", "--json");
      assert.equal(result.exitCode, 0, `${scope}: ${JSON.stringify(result)}`);
      const mutations = (await readProvider(fixture)).requests.filter(
        ({ method }) => method !== "GET",
      );
      assert.equal(
        mutations[0]?.method,
        scope === "this-and-future" ? "PATCH" : "DELETE",
      );
    }
  });
});

interface Fixture {
  calendarRoot: string;
  configPath: string;
  eventId: string;
  idempotencyKey: string;
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
  await Promise.all([
    mkdir(driveMount),
    mkdir(mirrorsRoot, { recursive: true }),
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
          primary: true,
          selected: true,
          etag: "academic-version",
        },
        { id: "commitments-id", summary: "Commitments", selected: true },
        { id: "routine-id", summary: "Routine", selected: true },
        { id: "observed-id", summary: "Observed", selected: true },
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
  return {
    calendarRoot,
    configPath,
    eventId,
    idempotencyKey,
    providerPath,
    writeCredential,
  };
}

async function setupChangeFixture(
  targetRole: "Academic" | "Routine",
  patch: Record<string, unknown> = targetRole === "Academic"
    ? { summary: "Updated title" }
    : {},
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
  return fixture;
}

async function setupRecurringChangeFixture(
  recurrenceScope: "this-occurrence" | "entire-series" | "this-and-future",
  targetRole: "Academic" | "Routine" = "Academic",
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
  const source = recurrenceScope === "entire-series" ? master : instance;
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
  return fixture;
}

async function setupRoutineMigrationFixture(): Promise<Fixture> {
  const fixture = await setupFixture();
  const master = {
    id: "sleep-series",
    summary: "Sleep",
    description: "Preserved series description",
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
  eventReadFailures?: string[];
  eventCreateFailures?: string[];
  events: Record<string, unknown[]>;
  incrementalEvents: Record<string, Record<string, unknown[]>>;
  omitCreatedFromIncremental?: boolean;
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
