import { OperationalError } from "../operational-error.js";
import type {
  CalendarEvent,
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
  for (const role of OWNED_CALENDAR_ROLES) {
    const events = await input.reader.listForwardEvents({
      calendarId: workspace.ownedCalendarIds[role],
      managementHorizon: input.managementHorizon,
    });
    mirrors.push(
      createMirror({
        role,
        calendarId: workspace.ownedCalendarIds[role],
        managementHorizon: input.managementHorizon,
        refreshedAt: input.refreshedAt,
        events: validateEvents(events),
      }),
    );
  }

  for (const mirror of mirrors) await input.mirrorStore.write(mirror);

  return {
    schemaVersion: 1,
    command: "calendar refresh",
    outcome: "refreshed",
    managementHorizon: input.managementHorizon,
    calendars: mirrors.map((mirror) => ({
      role: mirror.role,
      refreshedAt: mirror.refreshedAt,
      freshness: mirror.freshness,
      counts: countMirrorItems(mirror.items),
    })),
    placementSuggestions: mirrors.flatMap(placementSuggestions),
  };
}

function createMirror(input: {
  role: OwnedCalendarRole;
  calendarId: string;
  managementHorizon: string;
  refreshedAt: string;
  events: CalendarEvent[];
}): OwnedCalendarMirror {
  return {
    schemaVersion: 1,
    role: input.role,
    calendarId: input.calendarId,
    managementHorizon: input.managementHorizon,
    refreshedAt: input.refreshedAt,
    freshness: "fresh",
    items: input.events.map((event) => ({
      actualCalendarRole: input.role,
      access: isInvitedEvent(event) ? "invited-read-only" : "owned",
      event,
    })),
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
