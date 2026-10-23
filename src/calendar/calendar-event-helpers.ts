import { isDeepStrictEqual } from "node:util";
import type {
  CalendarEvent,
  CalendarEventPatch,
  CalendarIntendedEvent,
} from "./types.js";

export function idempotentExtendedProperties(
  event: CalendarEvent | CalendarIntendedEvent,
  idempotencyKey: string,
): Record<string, unknown> {
  const properties =
    "extendedProperties" in event && isRecord(event.extendedProperties)
      ? event.extendedProperties
      : {};
  return {
    ...properties,
    private: {
      ...(isRecord(properties.private) ? properties.private : {}),
      academicOsIdempotencyKey: idempotencyKey,
    },
  };
}

export function restorableEvent(
  event: CalendarEvent,
  idempotencyKey: string,
): CalendarEvent {
  const {
    id: _id,
    status: _status,
    recurringEventId: _recurringEventId,
    originalStartTime: _originalStartTime,
    organizer: _organizer,
    etag: _etag,
    created: _created,
    updated: _updated,
    creator: _creator,
    htmlLink: _htmlLink,
    iCalUID: _iCalUID,
    kind: _kind,
    hangoutLink: _hangoutLink,
    locked: _locked,
    ...rest
  } = event;
  rest.extendedProperties = idempotentExtendedProperties(event, idempotencyKey);
  return rest as CalendarEvent;
}

export function eventContainsPatch(
  event: CalendarEvent,
  patch: CalendarEventPatch,
): boolean {
  return Object.entries(patch).every(([key, value]) =>
    key === "recurrence"
      ? recurrenceMatches(event[key], value)
      : key === "start" || key === "end"
        ? calendarPointMatches(event[key], value)
        : isDeepStrictEqual(event[key], value),
  );
}

// Recurrence is a set of lines rather than a sequence, and a provider may hand back the ones it was
// sent in another order. Comparing them sorted compares the set. A value that is not a list of
// lines passes through untouched, so it still compares exactly the way every other field does.
export function recurrenceMatches(actual: unknown, expected: unknown): boolean {
  return isDeepStrictEqual(
    sortedRecurrence(actual),
    sortedRecurrence(expected),
  );
}

function calendarPointMatches(actual: unknown, expected: unknown): boolean {
  if (!isRecord(actual) || !isRecord(expected))
    return isDeepStrictEqual(actual, expected);
  if (expected.date !== undefined) return actual.date === expected.date;
  if (
    typeof actual.dateTime !== "string" ||
    typeof expected.dateTime !== "string"
  )
    return false;
  const intendedInstant = Date.parse(expected.dateTime);
  return (
    Number.isFinite(intendedInstant) &&
    Date.parse(actual.dateTime) === intendedInstant &&
    (expected.timeZone === undefined ||
      actual.timeZone === undefined ||
      actual.timeZone === expected.timeZone)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function isCalendarEvent(value: unknown): value is CalendarEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id !== "" &&
    isCalendarEventContent(value)
  );
}

export function isCalendarEventContent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of [
    "summary",
    "description",
    "location",
    "recurringEventId",
    "transparency",
    "visibility",
    "status",
    "etag",
  ])
    if (
      value[key] !== undefined &&
      typeof value[key] !== "string" &&
      !(key === "transparency" && value[key] === null)
    )
      return false;
  if (
    value.recurrence !== undefined &&
    (!Array.isArray(value.recurrence) ||
      !value.recurrence.every((line) => typeof line === "string"))
  )
    return false;
  for (const key of ["start", "end", "originalStartTime"]) {
    const point = value[key];
    if (point === undefined) continue;
    if (
      !isRecord(point) ||
      (typeof point.date !== "string" && typeof point.dateTime !== "string") ||
      (point.date !== undefined && point.dateTime !== undefined)
    )
      return false;
    for (const field of ["date", "dateTime", "timeZone"])
      if (point[field] !== undefined && typeof point[field] !== "string")
        return false;
  }
  if (
    value.organizer !== undefined &&
    (!isRecord(value.organizer) ||
      (value.organizer.self !== undefined &&
        typeof value.organizer.self !== "boolean") ||
      (value.organizer.email !== undefined &&
        typeof value.organizer.email !== "string"))
  )
    return false;
  return true;
}
