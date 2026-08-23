import { calendarStateDigest } from "./calendar-state-digest.js";
import type { CalendarEvent, CalendarEventPatch } from "./types.js";

export function eventContainsPatch(
  event: CalendarEvent,
  patch: CalendarEventPatch,
): boolean {
  return Object.entries(patch).every(([key, value]) =>
    key === "recurrence"
      ? recurrenceMatches(event[key], value)
      : calendarStateDigest(event[key]) === calendarStateDigest(value),
  );
}

// Recurrence is a set of lines rather than a sequence, and a provider may hand back the ones it was
// sent in another order. Comparing them sorted compares the set. A value that is not a list of
// lines passes through untouched, so it still compares exactly the way every other field does.
export function recurrenceMatches(actual: unknown, expected: unknown): boolean {
  return (
    calendarStateDigest(sortedRecurrence(actual)) ===
    calendarStateDigest(sortedRecurrence(expected))
  );
}

export function sortedRecurrence<Value>(value: Value): Value {
  return Array.isArray(value) ? ([...value].sort() as Value) : value;
}

export function isRecurringMaster(event: CalendarEvent): boolean {
  return (
    event.recurringEventId === undefined &&
    Array.isArray(event.recurrence) &&
    event.recurrence.length > 0
  );
}
