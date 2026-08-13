import { calendarStateDigest } from "./calendar-state-digest.js";
import type { CalendarEvent, CalendarEventPatch } from "./types.js";

export function eventContainsPatch(
  event: CalendarEvent,
  patch: CalendarEventPatch,
): boolean {
  return Object.entries(patch).every(
    ([key, value]) =>
      calendarStateDigest(event[key]) === calendarStateDigest(value),
  );
}

export function isRecurringMaster(event: CalendarEvent): boolean {
  return (
    event.recurringEventId === undefined &&
    Array.isArray(event.recurrence) &&
    event.recurrence.length > 0
  );
}
