import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createGoogleCalendarRefreshReader,
  refreshOwnedCalendars,
  OWNED_CALENDAR_ROLES,
  type OwnedCalendarMirror,
  type CalendarProposalStore,
} from "../../src/calendar/index.js";

it("retains Calendar state and proposals after cycling pagination and recovers on retry", async () => {
  const horizon = "2026-01-01T00:00:00.000Z";
  const prior = new Map(
    OWNED_CALENDAR_ROLES.map((role) => [
      role,
      {
        schemaVersion: 1 as const,
        role,
        calendarId: role,
        managementHorizon: horizon,
        lastSuccessfulRefresh: horizon,
        freshness: "fresh" as const,
        syncToken: "retained",
        items: [
          {
            actualCalendarRole: role,
            access: "owned" as const,
            event: { id: "existing", summary: "Synthetic event" },
          },
        ],
        tombstones: [],
      },
    ]),
  );
  const written: OwnedCalendarMirror[] = [];
  const deleted: unknown[] = [];
  let cycling = true;
  let calls = 0;
  const reader = createGoogleCalendarRefreshReader("/private/synthetic", {
    request: async <T>() => {
      calls += 1;
      if (calls > 9) throw new Error("fixture loop limit");
      return {
        data: {
          items: [],
          nextSyncToken: "next",
          ...(cycling ? { nextPageToken: "repeat" } : {}),
        } as T,
      };
    },
  });
  const input = {
    managementHorizon: horizon,
    refreshedAt: "2026-01-02T00:00:00.000Z",
    reader,
    workspaceReader: {
      read: async () => ({
        schemaVersion: 1 as const,
        defaultTimezone: "Asia/Singapore" as const,
        managementHorizon: horizon,
        ownedCalendarIds: {
          Academic: "Academic",
          Commitments: "Commitments",
          Routine: "Routine",
        },
      }),
    },
    mirrorStore: {
      read: async (role: (typeof OWNED_CALENDAR_ROLES)[number]) =>
        prior.get(role),
      write: async (value: OwnedCalendarMirror) => {
        written.push(value);
      },
    },
    proposalStore: {
      markStaleForDeletedItems: async (items: unknown[]) => {
        deleted.push(...items);
      },
    } as CalendarProposalStore,
  };
  assert.equal((await refreshOwnedCalendars(input)).outcome, "stale");
  assert.equal(calls, 6);
  assert.deepEqual(deleted, []);
  for (const mirror of written) {
    assert.equal(mirror.freshness, "stale");
    assert.deepEqual(mirror.items, prior.get(mirror.role)?.items);
    assert.equal(mirror.syncToken, "retained");
    assert.equal(mirror.lastSuccessfulRefresh, horizon);
  }
  cycling = false;
  assert.equal((await refreshOwnedCalendars(input)).outcome, "refreshed");
  assert.equal(calls, 9);
});
