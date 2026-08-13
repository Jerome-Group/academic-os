import type {
  CalendarEvent,
  CalendarInterval,
  CalendarListEntry,
  CalendarOverlap,
  CalendarProposalItemKind,
  CalendarProposalReader,
  OwnedCalendarMirror,
  OwnedCalendarRole,
} from "./types.js";
import { OWNED_CALENDAR_ROLES } from "./types.js";
import type { TravelBuffer } from "./calendar-proposal-input.js";

export interface CalendarAvailabilityItem {
  source: "Owned" | "Observed";
  calendarRole?: OwnedCalendarRole;
  calendarId: string;
  event: CalendarEvent;
}

export interface CalendarAvailability {
  items: CalendarAvailabilityItem[];
  checkedCalendarCount: number;
}

export async function collectCalendarAvailability(input: {
  reader: CalendarProposalReader;
  calendars: CalendarListEntry[];
  mirrors: OwnedCalendarMirror[];
  ownedCalendarIds: Record<OwnedCalendarRole, string>;
  interval: CalendarInterval;
}): Promise<CalendarAvailability> {
  const items = input.mirrors.flatMap((mirror) =>
    mirrorAvailability(mirror, input.interval),
  );
  for (const mirror of input.mirrors) {
    items.push(
      ...(await readMirroredRecurringOccurrences(
        input.reader,
        mirror,
        input.interval,
      )),
    );
  }
  const observedCalendars = input.calendars
    .filter((calendar) =>
      isVisibleSelectedObserved(calendar, input.ownedCalendarIds),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const calendar of observedCalendars) {
    const events = await input.reader.listEventOccurrences({
      calendarId: calendar.id,
      timeMin: input.interval.start,
      timeMax: input.interval.end,
    });
    items.push(
      ...events.map((event) => ({
        source: "Observed" as const,
        calendarId: calendar.id,
        event,
      })),
    );
  }
  const uniqueItems = new Map(
    items.map((item) => [availabilityIdentity(item), item] as const),
  );
  return {
    items: [...uniqueItems.values()].sort(compareAvailabilityItems),
    checkedCalendarCount: input.mirrors.length + observedCalendars.length,
  };
}

export function addTravelBuffer(
  interval: CalendarInterval | null,
  buffer: TravelBuffer,
): CalendarInterval | null {
  if (interval === null) return null;
  return {
    start: new Date(
      Date.parse(interval.start) - buffer.beforeMinutes * 60_000,
    ).toISOString(),
    end: new Date(
      Date.parse(interval.end) + buffer.afterMinutes * 60_000,
    ).toISOString(),
  };
}

export function findCalendarOverlaps(input: {
  availability: CalendarAvailabilityItem[];
  interval: CalendarInterval | null;
  proposedKind: CalendarProposalItemKind;
}): CalendarOverlap[] {
  if (input.interval === null) return [];
  const start = Date.parse(input.interval.start);
  const end = Date.parse(input.interval.end);
  return input.availability.flatMap((item) => {
    if (item.event.status === "cancelled") return [];
    const eventInterval = eventIntervalOf(item.event);
    if (
      eventInterval === null ||
      eventInterval.start >= end ||
      eventInterval.end <= start
    ) {
      return [];
    }
    const warning =
      input.proposedKind === "routine-event" ||
      item.calendarRole === "Routine" ||
      (item.source === "Owned" && item.event.transparency === "transparent");
    return [
      {
        severity: warning ? "warning" : "block",
        source: item.source,
        ...(item.calendarRole === undefined
          ? {}
          : { calendarRole: item.calendarRole }),
        eventId: item.event.id,
        summary: item.event.summary ?? "(untitled)",
        start: new Date(eventInterval.start).toISOString(),
        end: new Date(eventInterval.end).toISOString(),
      },
    ];
  });
}

function mirrorAvailability(
  mirror: OwnedCalendarMirror,
  interval: CalendarInterval,
): CalendarAvailabilityItem[] {
  return mirror.items.flatMap(({ event }) =>
    (Array.isArray(event.recurrence) && event.recurrence.length > 0) ||
    !eventOverlaps(event, interval)
      ? []
      : [
          {
            source: "Owned" as const,
            calendarRole: mirror.role,
            calendarId: mirror.calendarId,
            event,
          },
        ],
  );
}

function eventOverlaps(
  event: CalendarEvent,
  interval: CalendarInterval,
): boolean {
  const eventInterval = eventIntervalOf(event);
  return (
    eventInterval !== null &&
    eventInterval.start < Date.parse(interval.end) &&
    eventInterval.end > Date.parse(interval.start)
  );
}

async function readMirroredRecurringOccurrences(
  reader: CalendarProposalReader,
  mirror: OwnedCalendarMirror,
  interval: CalendarInterval,
): Promise<CalendarAvailabilityItem[]> {
  const seriesIds = new Set(
    mirror.items.flatMap(({ event }) =>
      Array.isArray(event.recurrence) && event.recurrence.length > 0
        ? [event.id]
        : [],
    ),
  );
  if (seriesIds.size === 0) return [];
  const events = await reader.listEventOccurrences({
    calendarId: mirror.calendarId,
    timeMin: interval.start,
    timeMax: interval.end,
  });
  return events.flatMap((event) =>
    (event.recurringEventId !== undefined &&
      seriesIds.has(event.recurringEventId)) ||
    seriesIds.has(event.id)
      ? [
          {
            source: "Owned" as const,
            calendarRole: mirror.role,
            calendarId: mirror.calendarId,
            event,
          },
        ]
      : [],
  );
}

function isVisibleSelectedObserved(
  calendar: CalendarListEntry,
  ownedCalendarIds: Record<OwnedCalendarRole, string>,
): boolean {
  return (
    !Object.values(ownedCalendarIds).includes(calendar.id) &&
    calendar.selected === true &&
    calendar.hidden !== true
  );
}

function eventIntervalOf(
  event: CalendarEvent,
): { start: number; end: number } | null {
  const start = event.start?.dateTime ?? dateStart(event.start?.date);
  const end = event.end?.dateTime ?? dateStart(event.end?.date);
  if (start === undefined || end === undefined) return null;
  const startValue = Date.parse(start);
  const endValue = Date.parse(end);
  if (Number.isNaN(startValue) || Number.isNaN(endValue)) return null;
  return { start: startValue, end: endValue };
}

function dateStart(value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${value}T00:00:00+08:00`;
}

function compareAvailabilityItems(
  left: CalendarAvailabilityItem,
  right: CalendarAvailabilityItem,
): number {
  const leftRole = left.calendarRole;
  const rightRole = right.calendarRole;
  if (leftRole !== undefined && rightRole !== undefined) {
    const roleOrder =
      OWNED_CALENDAR_ROLES.indexOf(leftRole) -
      OWNED_CALENDAR_ROLES.indexOf(rightRole);
    if (roleOrder !== 0) return roleOrder;
  } else if (leftRole !== undefined) {
    return -1;
  } else if (rightRole !== undefined) {
    return 1;
  }
  return availabilitySortKey(left).localeCompare(availabilitySortKey(right));
}

function availabilitySortKey(item: CalendarAvailabilityItem): string {
  return [
    item.calendarId,
    item.event.start?.dateTime ?? item.event.start?.date ?? "",
    item.event.end?.dateTime ?? item.event.end?.date ?? "",
    item.event.id,
  ].join("\0");
}

function availabilityIdentity(item: CalendarAvailabilityItem): string {
  return `${item.source}\0${item.calendarId}\0${item.event.id}`;
}
