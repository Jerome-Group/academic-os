import { OperationalError } from "../operational-error.js";
import type {
  CalendarIntendedEvent,
  CalendarInterval,
  CalendarProposalItemKind,
  CalendarProposalSource,
  OwnedCalendarRole,
} from "./types.js";

const TIMED_MILESTONE_DURATION_MINUTES = 1;

export interface TravelBuffer {
  beforeMinutes: number;
  afterMinutes: number;
}

export interface ParsedCalendarProposalInput {
  source: CalendarProposalSource;
  item: {
    kind: CalendarProposalItemKind;
    calendarRole: OwnedCalendarRole;
    summary: string;
    intendedEvent: CalendarIntendedEvent;
    occupiedInterval: CalendarInterval | null;
    travelBuffer: TravelBuffer;
  };
}

export function parseCalendarProposalInput(
  value: unknown,
  defaultTimezone: "Asia/Singapore",
): ParsedCalendarProposalInput {
  const root = requireObject(value, "Proposal input");
  if (root.schemaVersion !== 1) invalidInput("schemaVersion must be 1");
  const sourceValue = requireObject(root.source, "source");
  const source = {
    kind: requireNonEmptyString(sourceValue.kind, "source.kind"),
    reference: requireNonEmptyString(sourceValue.reference, "source.reference"),
  };
  const item = requireObject(root.item, "item");
  const kind = requireKind(item.kind);
  const calendarRole = requireRole(item.calendarRole);
  const summary = requireNonEmptyString(item.summary, "item.summary");
  validateRoleForKind(kind, calendarRole);

  if (kind === "fixed-event" || kind === "routine-event") {
    return {
      source,
      item: parseEvent({
        item,
        kind,
        calendarRole,
        summary,
        defaultTimezone,
      }),
    };
  }
  if (item.travelBuffer !== undefined) {
    invalidInput("milestones cannot have a travelBuffer");
  }
  return {
    source,
    item:
      kind === "timed-milestone"
        ? parseTimedMilestone({
            item,
            kind,
            calendarRole,
            summary,
            defaultTimezone,
          })
        : parseAllDayMilestone({ item, kind, calendarRole, summary }),
  };
}

function parseEvent(input: {
  item: Record<string, unknown>;
  kind: "fixed-event" | "routine-event";
  calendarRole: OwnedCalendarRole;
  summary: string;
  defaultTimezone: "Asia/Singapore";
}): ParsedCalendarProposalInput["item"] {
  const start = parseTimedPoint(
    input.item.start,
    "item.start",
    input.defaultTimezone,
  );
  const end = parseTimedPoint(
    input.item.end,
    "item.end",
    input.defaultTimezone,
  );
  if (Date.parse(end.dateTime) <= Date.parse(start.dateTime)) {
    invalidInput("item.end must be after item.start");
  }
  return {
    kind: input.kind,
    calendarRole: input.calendarRole,
    summary: input.summary,
    intendedEvent: {
      summary: input.summary,
      visibility: "private",
      transparency: input.kind === "fixed-event" ? "opaque" : "transparent",
      start,
      end,
    },
    occupiedInterval: { start: start.dateTime, end: end.dateTime },
    travelBuffer: parseTravelBuffer(input.item.travelBuffer),
  };
}

function parseTimedMilestone(input: {
  item: Record<string, unknown>;
  kind: "timed-milestone";
  calendarRole: OwnedCalendarRole;
  summary: string;
  defaultTimezone: "Asia/Singapore";
}): ParsedCalendarProposalInput["item"] {
  const at = parseTimedPoint(input.item.at, "item.at", input.defaultTimezone);
  return {
    kind: input.kind,
    calendarRole: input.calendarRole,
    summary: input.summary,
    intendedEvent: {
      summary: input.summary,
      visibility: "private",
      transparency: "transparent",
      start: at,
      end: {
        dateTime: new Date(
          Date.parse(at.dateTime) + TIMED_MILESTONE_DURATION_MINUTES * 60_000,
        ).toISOString(),
        timeZone: at.timeZone,
      },
    },
    occupiedInterval: null,
    travelBuffer: { beforeMinutes: 0, afterMinutes: 0 },
  };
}

function parseAllDayMilestone(input: {
  item: Record<string, unknown>;
  kind: "all-day-milestone";
  calendarRole: OwnedCalendarRole;
  summary: string;
}): ParsedCalendarProposalInput["item"] {
  const date = requireDate(input.item.date, "item.date");
  return {
    kind: input.kind,
    calendarRole: input.calendarRole,
    summary: input.summary,
    intendedEvent: {
      summary: input.summary,
      visibility: "private",
      transparency: "transparent",
      start: { date },
      end: { date: nextDate(date) },
    },
    occupiedInterval: null,
    travelBuffer: { beforeMinutes: 0, afterMinutes: 0 },
  };
}

function parseTimedPoint(
  value: unknown,
  name: string,
  defaultTimezone: "Asia/Singapore",
): { dateTime: string; timeZone: string } {
  const point = requireObject(value, name);
  const dateTime = requireNonEmptyString(point.dateTime, `${name}.dateTime`);
  if (
    Number.isNaN(Date.parse(dateTime)) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/u.test(dateTime)
  ) {
    invalidInput(`${name}.dateTime must be an ISO-8601 instant with an offset`);
  }
  const timeZone =
    point.timeZone === undefined
      ? defaultTimezone
      : requireNonEmptyString(point.timeZone, `${name}.timeZone`);
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    invalidInput(`${name}.timeZone must be an IANA timezone`);
  }
  return { dateTime, timeZone };
}

function parseTravelBuffer(value: unknown): TravelBuffer {
  if (value === undefined) return { beforeMinutes: 0, afterMinutes: 0 };
  const buffer = requireObject(value, "item.travelBuffer");
  return {
    beforeMinutes: requireNonNegativeInteger(
      buffer.beforeMinutes,
      "item.travelBuffer.beforeMinutes",
    ),
    afterMinutes: requireNonNegativeInteger(
      buffer.afterMinutes,
      "item.travelBuffer.afterMinutes",
    ),
  };
}

function validateRoleForKind(
  kind: CalendarProposalItemKind,
  calendarRole: OwnedCalendarRole,
): void {
  if (kind === "fixed-event" && calendarRole === "Routine") {
    invalidInput("fixed-event must target Academic or Commitments");
  }
  if (kind === "routine-event" && calendarRole !== "Routine") {
    invalidInput("routine-event must target Routine");
  }
}

function requireKind(value: unknown): CalendarProposalItemKind {
  if (
    value !== "fixed-event" &&
    value !== "routine-event" &&
    value !== "timed-milestone" &&
    value !== "all-day-milestone"
  ) {
    invalidInput("item.kind is not supported");
  }
  return value;
}

function requireRole(value: unknown): OwnedCalendarRole {
  if (value !== "Academic" && value !== "Commitments" && value !== "Routine") {
    invalidInput("item.calendarRole is not an Owned calendar role");
  }
  return value;
}

function requireDate(value: unknown, name: string): string {
  const date = requireNonEmptyString(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  ) {
    invalidInput(`${name} must be an ISO date`);
  }
  return date;
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    invalidInput(`${name} must be a non-negative integer`);
  }
  return value as number;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalidInput(`${name} must be a non-empty string`);
  }
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidInput(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function invalidInput(message: string): never {
  throw new OperationalError(
    "invalid-target",
    `Invalid Calendar Proposal input: ${message}.`,
  );
}
