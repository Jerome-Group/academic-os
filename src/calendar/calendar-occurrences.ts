import { OperationalError } from "../operational-error.js";
import type { CalendarEvent, CalendarInterval } from "./types.js";

export const CALENDAR_EXPANSION_VERSION = "finite-daily-weekly-v1";
export const CALENDAR_OCCURRENCE_LIMIT = 10_000;
const ITERATION_LIMIT = 100_000;
const DAY = 86_400_000;
const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface CalendarOccurrence {
  originalStart: string;
  interval: CalendarInterval;
  ordinal: number;
}

export interface CalendarExpansion {
  positions: CalendarOccurrence[];
  occurrences: CalendarOccurrence[];
}

export function calendarGeometry(
  event: CalendarEvent,
  calendarZone?: string,
): CalendarInterval {
  validateCalendarGeometry(event);
  const start = event.start;
  const end = event.end;
  if (
    start?.date !== undefined &&
    end?.date !== undefined &&
    start.dateTime === undefined &&
    end.dateTime === undefined
  ) {
    const first = localDate(start.date);
    const last = localDate(end.date);
    if (last <= first) refuse("all-day end must be an exclusive later date");
    return {
      start: localInstant(first, "00:00:00", calendarZone),
      end: localInstant(last, "00:00:00", calendarZone),
    };
  }
  if (
    start?.dateTime === undefined ||
    end?.dateTime === undefined ||
    start.date !== undefined ||
    end.date !== undefined
  ) {
    refuse("event requires matching, complete start and end geometry");
  }
  const first = exactInstant(start.dateTime);
  const last = exactInstant(end.dateTime);
  if (last <= first) refuse("event end must be after start");
  return {
    start: new Date(first).toISOString(),
    end: new Date(last).toISOString(),
  };
}

export function validateCalendarGeometry(event: CalendarEvent): void {
  const { start, end } = event;
  if (
    start?.date !== undefined &&
    end?.date !== undefined &&
    start.dateTime === undefined &&
    end.dateTime === undefined
  ) {
    if (localDate(end.date) <= localDate(start.date))
      refuse("all-day end must be an exclusive later date");
    return;
  }
  if (
    start?.dateTime === undefined ||
    end?.dateTime === undefined ||
    start.date !== undefined ||
    end.date !== undefined
  )
    refuse("event requires matching, complete start and end geometry");
  if (exactInstant(end.dateTime) <= exactInstant(start.dateTime))
    refuse("event end must be after start");
}

export function expandCalendarEvent(
  event: CalendarEvent,
  calendarZone?: string,
  through?: string,
): CalendarExpansion {
  const geometry = calendarGeometry(event, calendarZone);
  if (event.recurrence === undefined || event.recurrence.length === 0) {
    const occurrence = {
      originalStart: geometry.start,
      interval: geometry,
      ordinal: 0,
    };
    return { positions: [occurrence], occurrences: [occurrence] };
  }
  const allDay = event.start?.date !== undefined;
  const zone = allDay ? calendarZone : event.start?.timeZone;
  const offset = supportedOffset(zone);
  if (
    !allDay &&
    event.end?.timeZone !== undefined &&
    event.end.timeZone !== zone
  )
    refuse("recurring start and end zones must agree");
  const localStart = allDay
    ? localDate(event.start?.date)
    : localPoint(event.start?.dateTime, offset, zone);
  const startDate = localStart.slice(0, 10);
  const localTime = allDay ? "00:00:00" : localStart.slice(11);
  const duration = Date.parse(geometry.end) - Date.parse(geometry.start);
  if (allDay && duration % DAY !== 0)
    refuse("unsupported all-day zone duration");
  const rules = event.recurrence.filter((line) => line.startsWith("RRULE:"));
  if (rules.length !== 1) refuse("one DAILY or WEEKLY RRULE is required");
  const rule = rules[0];
  if (rule === undefined) refuse("missing recurrence rule");
  const parts = new Map<string, string>();
  for (const part of rule.slice(6).split(";")) {
    const pair = part.split("=");
    const key = pair[0];
    const value = pair[1];
    if (
      pair.length !== 2 ||
      key === undefined ||
      value === undefined ||
      value === "" ||
      parts.has(key)
    )
      refuse("malformed or duplicate RRULE part");
    if (!["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST"].includes(key))
      refuse(`unsupported RRULE part ${key}`);
    parts.set(key, value);
  }
  const frequency = parts.get("FREQ");
  if (frequency !== "DAILY" && frequency !== "WEEKLY")
    refuse("only DAILY and WEEKLY recurrence is supported");
  const interval = positiveInteger(parts.get("INTERVAL") ?? "1", "INTERVAL");
  const countValue = parts.get("COUNT");
  const untilValue = parts.get("UNTIL");
  if (countValue !== undefined && untilValue !== undefined)
    refuse("COUNT and UNTIL cannot be combined");
  if (
    countValue === undefined &&
    untilValue === undefined &&
    through === undefined
  )
    refuse("unbounded busy recurrence requires a finite COUNT or UNTIL");
  const count =
    countValue === undefined ? undefined : positiveInteger(countValue, "COUNT");
  if (count !== undefined && count > CALENDAR_OCCURRENCE_LIMIT)
    refuse(`occurrence budget ${CALENDAR_OCCURRENCE_LIMIT} exceeded`);
  const until =
    untilValue === undefined
      ? undefined
      : recurrenceInstant(untilValue, allDay, zone);
  const throughInstant =
    through === undefined
      ? undefined
      : allDay
        ? Date.parse(localInstant(localDate(through), "00:00:00", zone))
        : exactInstant(through);
  const startDay = Date.parse(`${startDate}T00:00:00Z`);
  const firstWeekday = new Date(startDay).getUTCDay();
  const byDay = parts.get("BYDAY");
  if (frequency === "DAILY" && (byDay !== undefined || parts.has("WKST")))
    refuse("DAILY BYDAY/WKST is not supported");
  const selectedWeekdays =
    byDay === undefined
      ? [firstWeekday]
      : byDay.split(",").map((value) => {
          const weekday = weekdays.indexOf(value);
          if (weekday < 0) refuse("weekly BYDAY requires nonordinal weekdays");
          return weekday;
        });
  if (
    new Set(selectedWeekdays).size !== selectedWeekdays.length ||
    !selectedWeekdays.includes(firstWeekday)
  )
    refuse("DTSTART must agree with unique weekly BYDAY");
  const weekStart = weekdays.indexOf(parts.get("WKST") ?? "MO");
  if (weekStart < 0) refuse("invalid WKST");
  const firstWeek = startDay - ((firstWeekday - weekStart + 7) % 7) * DAY;
  const exclusions = new Set<number>();
  for (const line of event.recurrence) {
    if (line === rule) continue;
    const match = line.match(
      /^EXDATE(?:;TZID=([^:;]+)|;VALUE=DATE)?:([\dTZ,]+)$/u,
    );
    if (match === null)
      refuse(`unsupported recurrence line ${line.split(":")[0] ?? "unknown"}`);
    const exclusionZone = match[1];
    for (const value of (match[2] ?? "").split(",")) {
      if (allDay) {
        if (exclusionZone !== undefined || !/^\d{8}$/u.test(value))
          refuse("EXDATE must match all-day DTSTART");
        exclusions.add(
          Date.parse(localInstant(compactDate(value), "00:00:00", zone)),
        );
      } else if (/^\d{8}T\d{6}Z$/u.test(value) && exclusionZone === undefined) {
        exclusions.add(exactInstant(compactDateTime(value)));
      } else if (/^\d{8}T\d{6}$/u.test(value) && exclusionZone === zone) {
        exclusions.add(
          Date.parse(
            localInstant(
              compactDate(value.slice(0, 8)),
              compactTime(value.slice(9)),
              zone,
            ),
          ),
        );
      } else refuse("EXDATE must be UTC or use the recurring DTSTART timezone");
    }
  }
  const positions: CalendarOccurrence[] = [];
  let ended = false;
  for (let index = 0; index < ITERATION_LIMIT; index += 1) {
    const day = startDay + index * DAY;
    const date = new Date(day).toISOString().slice(0, 10);
    localDate(date);
    const dateStart = localInstant(date, localTime, zone);
    const startInstant = Date.parse(dateStart);
    if (
      (until !== undefined && startInstant > until) ||
      (throughInstant !== undefined && startInstant > throughInstant)
    ) {
      ended = true;
      break;
    }
    const dayOfWeek = new Date(day).getUTCDay();
    const selected =
      frequency === "DAILY"
        ? index % interval === 0
        : Math.floor((day - firstWeek) / (7 * DAY)) % interval === 0 &&
          selectedWeekdays.includes(dayOfWeek);
    if (!selected) continue;
    const end = new Date(startInstant + duration).toISOString();
    validateZoneBoundary(end, zone);
    const occurrence: CalendarOccurrence = {
      originalStart: allDay ? date : dateStart,
      interval: { start: dateStart, end },
      ordinal: positions.length,
    };
    positions.push(occurrence);
    if (positions.length > CALENDAR_OCCURRENCE_LIMIT)
      refuse(`occurrence budget ${CALENDAR_OCCURRENCE_LIMIT} exceeded`);
    if (count !== undefined && positions.length === count) {
      ended = true;
      break;
    }
  }
  if (!ended) refuse(`recurrence iteration budget ${ITERATION_LIMIT} exceeded`);
  if (positions.length === 0) refuse("recurrence bound precedes DTSTART");
  return {
    positions,
    occurrences: positions.filter(
      ({ interval: value }) => !exclusions.has(Date.parse(value.start)),
    ),
  };
}

export function originalCalendarStart(event: CalendarEvent): string {
  const point = event.originalStartTime;
  if (point?.date !== undefined && point.dateTime === undefined)
    return localDate(point.date);
  if (point?.dateTime !== undefined && point.date === undefined)
    return new Date(exactInstant(point.dateTime)).toISOString();
  refuse("recurring occurrence requires an immutable originalStartTime");
}

export function exactInstant(value: unknown): number {
  if (typeof value !== "string")
    refuse("timed boundary must be an offset instant");
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u,
  );
  if (match === null)
    refuse("timed boundary must be a four-digit RFC3339 offset instant");
  localDate(match[1]);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59)
    refuse("invalid timed boundary");
  const epoch = Date.parse(value);
  if (
    !Number.isFinite(epoch) ||
    new Date(epoch).getUTCFullYear() < 1 ||
    new Date(epoch).getUTCFullYear() > 9999
  )
    refuse("instant is outside supported RFC3339 dates");
  return epoch;
}

function localPoint(
  value: unknown,
  offset: number,
  zone: string | undefined,
): string {
  const epoch = exactInstant(value);
  validateZoneBoundary(new Date(epoch).toISOString(), zone);
  return new Date(epoch + offset)
    .toISOString()
    .slice(0, -1)
    .replace(/\.000$/u, "");
}

function recurrenceInstant(
  value: string,
  allDay: boolean,
  zone: string | undefined,
): number {
  if (allDay) {
    if (!/^\d{8}$/u.test(value)) refuse("all-day UNTIL requires a date");
    return Date.parse(localInstant(compactDate(value), "00:00:00", zone));
  }
  if (!/^\d{8}T\d{6}Z$/u.test(value))
    refuse("timed UNTIL requires a UTC date-time");
  return exactInstant(compactDateTime(value));
}

function compactDate(value: string): string {
  return localDate(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
  );
}
function compactTime(value: string): string {
  return `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}`;
}
function compactDateTime(value: string): string {
  return `${compactDate(value.slice(0, 8))}T${compactTime(value.slice(9, 15))}Z`;
}

export function localDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    value < "0001-01-01" ||
    value > "9999-12-31"
  )
    refuse("unsupported calendar date");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  )
    refuse("invalid calendar date");
  return value;
}

function supportedOffset(zone: string | undefined): number {
  if (zone === "UTC") return 0;
  if (zone === "Asia/Singapore") return 8 * 3_600_000;
  refuse(`unsupported recurrence/all-day timezone ${zone ?? "missing"}`);
}

function localInstant(
  date: string,
  time: string,
  zone: string | undefined,
): string {
  const offset = supportedOffset(zone);
  const wall = `${localDate(date)}T${time}`;
  const instant = new Date(
    exactInstant(`${wall}${offset === 0 ? "Z" : "+08:00"}`),
  ).toISOString();
  validateZoneBoundary(instant, zone);
  return instant;
}

function validateZoneBoundary(instant: string, zone: string | undefined): void {
  const offset = supportedOffset(zone);
  const expected = new Date(Date.parse(instant) + offset).toISOString();
  if (zone === "Asia/Singapore" && expected.slice(0, 10) < "1982-01-01")
    refuse(
      "Singapore recurrence/all-day dates before 1982-01-01 are unsupported",
    );
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]),
  );
  const actual = `${parts.year?.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  if (actual !== expected.slice(0, 19))
    refuse(
      "installed Intl timezone data disagrees with the supported fixed-offset era",
    );
}

function positiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value)))
    refuse(`invalid ${name}`);
  return Number(value);
}

function refuse(message: string): never {
  throw new OperationalError(
    "invalid-target",
    `Calendar coverage unsupported: ${message}.`,
  );
}
