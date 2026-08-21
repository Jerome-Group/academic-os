import { calendarStateDigest } from "./calendar-state-digest.js";
import type { CalendarEvent, CalendarEventPatch } from "./types.js";

export function eventContainsPatch(
  event: CalendarEvent,
  patch: CalendarEventPatch,
): boolean {
  return Object.entries(patch).every(([key, value]) =>
    key === "recurrence"
      ? recurrenceLinesMatchIgnoringOrder(event[key], value)
      : calendarStateDigest(event[key]) === calendarStateDigest(value),
  );
}

function recurrenceLinesMatchIgnoringOrder(
  actual: unknown,
  expected: unknown,
): boolean {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  return (
    calendarStateDigest([...actual].sort()) ===
    calendarStateDigest([...expected].sort())
  );
}

export function isRecurringMaster(event: CalendarEvent): boolean {
  return (
    event.recurringEventId === undefined &&
    Array.isArray(event.recurrence) &&
    event.recurrence.length > 0
  );
}
