import assert from "node:assert/strict";
import { it } from "node:test";

import { createCalendarProposal } from "../../src/calendar/create-calendar-proposal.js";
import { refreshOwnedCalendars } from "../../src/calendar/refresh-owned-calendars.js";
import {
  OWNED_CALENDAR_ROLES,
  type CalendarEvent,
  type CalendarProposal,
  type CalendarProposalStore,
  type OwnedCalendarMirror,
  type OwnedCalendarWorkspace,
} from "../../src/calendar/types.js";

const workspace: OwnedCalendarWorkspace = {
  schemaVersion: 1,
  defaultTimezone: "Asia/Singapore",
  managementHorizon: "2026-01-01T00:00:00Z",
  ownedCalendarIds: {
    Academic: "academic",
    Commitments: "commitments",
    Routine: "routine",
  },
};
function fixtures(events: CalendarEvent[]) {
  const mirrors = new Map(
    OWNED_CALENDAR_ROLES.map((role) => [
      role,
      {
        schemaVersion: 1,
        role,
        calendarId: workspace.ownedCalendarIds[role],
        managementHorizon: workspace.managementHorizon,
        freshness: "fresh",
        syncToken: "old",
        lastSuccessfulRefresh: "2026-09-26T00:00:00Z",
        items:
          role === "Academic"
            ? events.map((event) => ({
                actualCalendarRole: role,
                access:
                  event.organizer?.self === false
                    ? "invited-read-only"
                    : "owned",
                event,
              }))
            : [],
        tombstones: [],
      } as OwnedCalendarMirror,
    ]),
  );
  let proposal: CalendarProposal | undefined;
  const proposalStore: CalendarProposalStore = {
    read: async () => proposal,
    writeCurrent: async (value) => {
      proposal = value;
    },
    markPromoted: async () => {},
    markStale: async () => {},
    markStaleForDeletedItems: async () => {},
  };
  const mirrorStore = {
    read: async (role: OwnedCalendarMirror["role"]) => mirrors.get(role),
    write: async (mirror: OwnedCalendarMirror) => {
      mirrors.set(mirror.role, mirror);
    },
  };
  return { mirrors, mirrorStore, proposalStore, proposal: () => proposal };
}

it("retains invited access on a sparse deletion tombstone and refuses its restoration", async () => {
  const fixture = fixtures([
    { id: "invitation", summary: "Invited", organizer: { self: false } },
  ]);
  await refreshOwnedCalendars({
    managementHorizon: workspace.managementHorizon,
    workspaceReader: { read: async () => workspace },
    mirrorStore: fixture.mirrorStore,
    proposalStore: fixture.proposalStore,
    reader: {
      listEventChanges: async ({ calendarId }) => ({
        events:
          calendarId === "academic"
            ? [{ id: "invitation", status: "cancelled" }]
            : [],
        nextSyncToken: "new",
      }),
    },
    refreshedAt: "2026-09-26T00:00:00Z",
  });
  assert.equal(
    fixture.mirrors.get("Academic")?.tombstones[0]?.access,
    "invited-read-only",
  );
  await assert.rejects(
    createCalendarProposal({
      value: {
        schemaVersion: 1,
        source: { kind: "manual", reference: "restore" },
        item: {
          operation: "restore",
          calendarRole: "Academic",
          eventId: "invitation",
        },
      },
      workspaceReader: { read: async () => workspace },
      mirrorStore: fixture.mirrorStore,
      proposalStore: fixture.proposalStore,
      reader: {
        listCalendars: async () => [],
        listEventOccurrences: async () => [],
      },
    }),
    /Invited events cannot be restored/u,
  );
});

it("keeps future all-day recurrence exceptions and excludes past exceptions", async () => {
  const fixture = fixtures([
    {
      id: "master",
      recurrence: ["RRULE:FREQ=DAILY;COUNT=10"],
      start: { date: "2026-10-01" },
      end: { date: "2026-10-02" },
    },
    {
      id: "past",
      recurringEventId: "master",
      originalStartTime: { date: "2026-10-02" },
      start: { date: "2026-10-02" },
    },
    {
      id: "split",
      recurringEventId: "master",
      originalStartTime: { date: "2026-10-03" },
      start: { date: "2026-10-03" },
      end: { date: "2026-10-04" },
    },
    {
      id: "future",
      recurringEventId: "master",
      originalStartTime: { date: "2026-10-04" },
      start: { date: "2026-10-05" },
    },
  ]);
  const result = await propose(fixture, "split");
  assert.equal(result.outcome, "ready");
  const proposal = fixture.proposal();
  assert.ok(proposal?.operation === "update");
  assert.deepEqual(
    proposal.recurrenceExceptions?.map((event) => event.id),
    ["future"],
  );
});

it("selects future recurrence exceptions by instant across different offsets", async () => {
  const fixture = fixtures([
    {
      id: "master",
      recurrence: ["RRULE:FREQ=DAILY;COUNT=10"],
      start: { dateTime: "2026-10-01T10:00:00+08:00" },
      end: { dateTime: "2026-10-01T11:00:00+08:00" },
    },
    {
      id: "split",
      recurringEventId: "master",
      originalStartTime: { dateTime: "2026-10-03T10:00:00+08:00" },
      start: { dateTime: "2026-10-03T10:00:00+08:00" },
      end: { dateTime: "2026-10-03T11:00:00+08:00" },
    },
    {
      id: "later",
      recurringEventId: "master",
      originalStartTime: { dateTime: "2026-10-03T03:00:00Z" },
    },
    {
      id: "earlier",
      recurringEventId: "master",
      originalStartTime: { dateTime: "2026-10-03T09:00:00+09:00" },
    },
  ]);
  await propose(fixture, "split");
  const proposal = fixture.proposal();
  assert.ok(proposal?.operation === "update");
  assert.deepEqual(
    proposal.recurrenceExceptions?.map((event) => event.id),
    ["later"],
  );
});

async function propose(fixture: ReturnType<typeof fixtures>, eventId: string) {
  return await createCalendarProposal({
    value: {
      schemaVersion: 1,
      source: { kind: "manual", reference: "edit" },
      item: {
        operation: "update",
        calendarRole: "Academic",
        eventId,
        recurrenceScope: "this-and-future",
        patch: { summary: "Updated" },
      },
    },
    workspaceReader: { read: async () => workspace },
    mirrorStore: fixture.mirrorStore,
    proposalStore: fixture.proposalStore,
    reader: {
      listCalendars: async () => [],
      listEventOccurrences: async () => [],
    },
  });
}
