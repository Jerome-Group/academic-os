import { OperationalError } from "../operational-error.js";
import { CalendarSyncTokenExpiredError } from "./calendar-refresh-error.js";
import type {
  CalendarEvent,
  CalendarProposalStore,
  CalendarRefreshReader,
  CalendarRefreshReport,
  MirroredCalendarItem,
  OwnedCalendarMirror,
  OwnedCalendarMirrorStore,
  OwnedCalendarRole,
  OwnedCalendarWorkspaceReader,
  PlacementSuggestion,
} from "./types.js";
import { OWNED_CALENDAR_ROLES } from "./types.js";

export async function refreshOwnedCalendars(input: {
  managementHorizon: string;
  reader: CalendarRefreshReader;
  workspaceReader: OwnedCalendarWorkspaceReader;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
  refreshedAt: string;
}): Promise<CalendarRefreshReport> {
  const workspace = await input.workspaceReader.read();
  if (workspace.managementHorizon !== input.managementHorizon) {
    throw new OperationalError(
      "invalid-config",
      "Calendar setup must be rerun after changing the Management horizon.",
    );
  }

  const mirrors: OwnedCalendarMirror[] = [];
  const deletedItems: Array<{
    calendarRole: OwnedCalendarRole;
    eventId: string;
  }> = [];
  for (const role of OWNED_CALENDAR_ROLES) {
    const previous = await input.mirrorStore.read(role);
    try {
      const changes = await readChanges({
        reader: input.reader,
        calendarId: workspace.ownedCalendarIds[role],
        managementHorizon: input.managementHorizon,
        syncToken: previous?.syncToken,
      });
      const refreshed = createFreshMirror({
        role,
        calendarId: workspace.ownedCalendarIds[role],
        managementHorizon: input.managementHorizon,
        refreshedAt: input.refreshedAt,
        previous,
        incremental:
          previous?.syncToken !== undefined && !changes.performedFullRefresh,
        events: validateEvents(changes.events),
        nextSyncToken: changes.nextSyncToken,
      });
      const mirror = refreshed.mirror;
      mirrors.push(mirror);
      deletedItems.push(
        ...refreshed.deletedEventIds.map((eventId) => ({
          calendarRole: role,
          eventId,
        })),
      );
    } catch {
      const stale = createStaleMirror({
        role,
        calendarId: workspace.ownedCalendarIds[role],
        managementHorizon: input.managementHorizon,
        previous,
      });
      mirrors.push(stale);
    }
  }
  await input.proposalStore.markStaleForDeletedItems(deletedItems);
  for (const mirror of mirrors) await input.mirrorStore.write(mirror);

  const staleCount = mirrors.filter(
    ({ freshness }) => freshness === "stale",
  ).length;

  return {
    schemaVersion: 1,
    command: "calendar refresh",
    outcome:
      staleCount === 0
        ? "refreshed"
        : staleCount === mirrors.length
          ? "stale"
          : "partially-refreshed",
    managementHorizon: input.managementHorizon,
    calendars: mirrors.map((mirror) => ({
      role: mirror.role,
      lastSuccessfulRefresh: mirror.lastSuccessfulRefresh,
      freshness: mirror.freshness,
      counts: countMirrorItems(mirror.items),
    })),
    placementSuggestions: mirrors
      .filter(({ freshness }) => freshness === "fresh")
      .flatMap(placementSuggestions),
  };
}

async function readChanges(input: {
  reader: CalendarRefreshReader;
  calendarId: string;
  managementHorizon: string;
  syncToken?: string | undefined;
}): Promise<{
  events: CalendarEvent[];
  nextSyncToken: string;
  performedFullRefresh: boolean;
}> {
  try {
    return {
      ...(await input.reader.listEventChanges({
        calendarId: input.calendarId,
        managementHorizon: input.managementHorizon,
        ...(input.syncToken === undefined
          ? {}
          : { syncToken: input.syncToken }),
      })),
      performedFullRefresh: false,
    };
  } catch (error) {
    if (!(error instanceof CalendarSyncTokenExpiredError)) throw error;
    return {
      ...(await input.reader.listEventChanges({
        calendarId: input.calendarId,
        managementHorizon: input.managementHorizon,
      })),
      performedFullRefresh: true,
    };
  }
}

function createFreshMirror(input: {
  role: OwnedCalendarRole;
  calendarId: string;
  managementHorizon: string;
  refreshedAt: string;
  previous?: OwnedCalendarMirror | undefined;
  incremental: boolean;
  events: CalendarEvent[];
  nextSyncToken: string;
}): { mirror: OwnedCalendarMirror; deletedEventIds: string[] } {
  const previousItems = input.incremental ? (input.previous?.items ?? []) : [];
  const itemsById = new Map(
    previousItems.map((item) => [item.event.id, item] as const),
  );
  const tombstonesById = new Map(
    (input.previous?.tombstones ?? []).map((tombstone) => [
      tombstone.event.id,
      tombstone,
    ]),
  );
  const deletedEventIds = new Set<string>();
  for (const event of input.events) {
    if (event.status === "cancelled") {
      const lastKnown = itemsById.get(event.id)?.event;
      itemsById.delete(event.id);
      tombstonesById.set(event.id, {
        deletedAt: input.refreshedAt,
        event: lastKnown ?? tombstonesById.get(event.id)?.event ?? event,
      });
      deletedEventIds.add(event.id);
      continue;
    }
    itemsById.set(event.id, {
      actualCalendarRole: input.role,
      access: isInvitedEvent(event) ? "invited-read-only" : "owned",
      event,
    });
    tombstonesById.delete(event.id);
  }
  if (!input.incremental) {
    for (const item of input.previous?.items ?? []) {
      if (itemsById.has(item.event.id)) continue;
      if (!tombstonesById.has(item.event.id)) {
        tombstonesById.set(item.event.id, {
          deletedAt: input.refreshedAt,
          event: item.event,
        });
      }
      deletedEventIds.add(item.event.id);
    }
  }
  return {
    mirror: {
      schemaVersion: 1,
      role: input.role,
      calendarId: input.calendarId,
      managementHorizon: input.managementHorizon,
      lastSuccessfulRefresh: input.refreshedAt,
      freshness: "fresh",
      syncToken: input.nextSyncToken,
      items: [...itemsById.values()],
      tombstones: [...tombstonesById.values()],
    },
    deletedEventIds: [...deletedEventIds],
  };
}

function createStaleMirror(input: {
  role: OwnedCalendarRole;
  calendarId: string;
  managementHorizon: string;
  previous?: OwnedCalendarMirror | undefined;
}): OwnedCalendarMirror {
  return {
    schemaVersion: 1,
    role: input.role,
    calendarId: input.calendarId,
    managementHorizon: input.managementHorizon,
    lastSuccessfulRefresh: input.previous?.lastSuccessfulRefresh ?? null,
    freshness: "stale",
    ...(input.previous?.syncToken === undefined
      ? {}
      : { syncToken: input.previous.syncToken }),
    items: input.previous?.items ?? [],
    tombstones: input.previous?.tombstones ?? [],
  };
}

function validateEvents(events: CalendarEvent[]): CalendarEvent[] {
  if (
    !Array.isArray(events) ||
    events.some(
      (event) =>
        typeof event !== "object" ||
        event === null ||
        typeof event.id !== "string" ||
        event.id === "",
    )
  ) {
    throw new OperationalError(
      "operational-failure",
      "Calendar Refresh received an invalid provider response.",
    );
  }
  return events;
}

function isInvitedEvent(event: CalendarEvent): boolean {
  return event.organizer !== undefined && event.organizer.self !== true;
}

function countMirrorItems(
  items: MirroredCalendarItem[],
): CalendarRefreshReport["calendars"][number]["counts"] {
  return {
    items: items.length,
    recurringMasters: items.filter(
      ({ event }) =>
        Array.isArray(event.recurrence) && event.recurrence.length > 0,
    ).length,
    exceptions: items.filter(
      ({ event }) =>
        typeof event.recurringEventId === "string" &&
        event.recurringEventId !== "",
    ).length,
    invited: items.filter(({ access }) => access === "invited-read-only")
      .length,
  };
}

function placementSuggestions(
  mirror: OwnedCalendarMirror,
): PlacementSuggestion[] {
  if (mirror.role === "Routine") return [];
  return mirror.items.flatMap((item) => {
    if (
      item.access === "invited-read-only" ||
      item.event.transparency !== "transparent" ||
      !Array.isArray(item.event.recurrence) ||
      item.event.recurrence.length === 0
    ) {
      return [];
    }
    return [
      {
        eventId: item.event.id,
        summary: item.event.summary ?? "(untitled)",
        actualRole: mirror.role,
        suggestedRole: "Routine" as const,
        reason: "transparent-recurring" as const,
      },
    ];
  });
}
