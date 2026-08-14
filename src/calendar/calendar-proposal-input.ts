import { OperationalError } from "../operational-error.js";
import {
  localNtuDateTime,
  ntuWeeklyClassSchedule,
  NTU_AY2026_27_SEMESTER_1,
  type NtuWeekSelection,
  type NtuWeekday,
} from "./ntu-academic-calendar.js";
import type {
  CalendarIntendedEvent,
  CalendarEventPatch,
  CalendarInterval,
  CalendarProposalItemKind,
  CalendarProposalSource,
  CalendarRecurrenceScope,
  CalendarProviderIdentity,
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

export interface ParsedCalendarBulkCreateItem {
  key: string;
  itemKind: "fixed-event";
  intendedEvent: CalendarIntendedEvent;
  occupiedIntervals: CalendarInterval[];
}

export interface ParsedCalendarAcademicTimetableProposalInput {
  operation: "academic-timetable";
  source: CalendarProposalSource;
  calendarRole: "Academic";
  items: ParsedCalendarBulkCreateItem[];
}

export interface ParsedCalendarChangeProposalInput {
  operation: "update";
  source: CalendarProposalSource;
  calendarRole: OwnedCalendarRole;
  eventId: string;
  patch: CalendarEventPatch;
  targetCalendarRole?: OwnedCalendarRole;
  recurrenceScope?: CalendarRecurrenceScope;
}

export interface ParsedCalendarCancelProposalInput {
  operation: "cancel";
  source: CalendarProposalSource;
  calendarRole: OwnedCalendarRole;
  eventId: string;
  recurrenceScope?: CalendarRecurrenceScope;
}

export interface ParsedCalendarRestoreProposalInput {
  operation: "restore";
  source: CalendarProposalSource;
  calendarRole: OwnedCalendarRole;
  eventId: string;
}

export interface ParsedCalendarRoutineMigrationProposalInput {
  operation: "routine-migration";
  source: CalendarProposalSource;
  reviewedSeries: Array<{
    providerIdentity: CalendarProviderIdentity;
    label?: string;
  }>;
}

export type ParsedCalendarActionProposalInput =
  | ParsedCalendarChangeProposalInput
  | ParsedCalendarCancelProposalInput
  | ParsedCalendarRestoreProposalInput;

export function parseCalendarAcademicTimetableProposalInput(
  value: unknown,
  defaultTimezone: "Asia/Singapore",
): ParsedCalendarAcademicTimetableProposalInput | undefined {
  if (!isObject(value) || !isObject(value.item)) return undefined;
  if (value.item.operation !== "academic-timetable") return undefined;
  if (value.schemaVersion !== 1) invalidInput("schemaVersion must be 1");
  if (defaultTimezone !== NTU_AY2026_27_SEMESTER_1.timezone) {
    invalidInput("academic-timetable requires Asia/Singapore");
  }
  const source = parseSource(value.source);
  const item = value.item;
  if (item.calendarRole !== "Academic") {
    invalidInput("item.calendarRole must be Academic");
  }
  if (item.term !== NTU_AY2026_27_SEMESTER_1.term) {
    invalidInput(`item.term must be ${NTU_AY2026_27_SEMESTER_1.term}`);
  }
  const classes = requireArray(item.classes, "item.classes");
  const exams = requireArray(item.exams, "item.exams");
  const seen = new Set<string>();
  const parsedClasses = classes.map((entry, index) =>
    parseAcademicClass(entry, index, defaultTimezone, seen),
  );
  const parsedExams = exams.map((entry, index) =>
    parseAcademicExam(entry, index, defaultTimezone, seen),
  );
  if (parsedClasses.length + parsedExams.length === 0) {
    invalidInput("item.classes or item.exams must contain an event");
  }
  return {
    operation: "academic-timetable",
    source,
    calendarRole: "Academic",
    items: [...parsedClasses, ...parsedExams],
  };
}

export function parseCalendarRoutineMigrationProposalInput(
  value: unknown,
): ParsedCalendarRoutineMigrationProposalInput | undefined {
  if (!isObject(value) || !isObject(value.item)) return undefined;
  if (value.item.operation !== "routine-migration") return undefined;
  if (value.schemaVersion !== 1) invalidInput("schemaVersion must be 1");
  const sourceValue = requireObject(value.source, "source");
  const source = {
    kind: requireNonEmptyString(sourceValue.kind, "source.kind"),
    reference: requireNonEmptyString(sourceValue.reference, "source.reference"),
  };
  const reviewedValue = value.item.reviewedSeries;
  if (!Array.isArray(reviewedValue)) {
    invalidInput("item.reviewedSeries must be an array");
  }
  const seen = new Set<string>();
  const reviewedSeries = reviewedValue.map((entry, index) => {
    const reviewed = requireObject(
      entry,
      `item.reviewedSeries[${index.toString()}]`,
    );
    const providerIdentityValue = requireObject(
      reviewed.providerIdentity,
      `item.reviewedSeries[${index.toString()}].providerIdentity`,
    );
    const calendarRole = requireRole(providerIdentityValue.calendarRole);
    if (calendarRole !== "Academic") {
      invalidInput(
        `item.reviewedSeries[${index.toString()}].providerIdentity.calendarRole must be Academic`,
      );
    }
    const calendarId = requireNonEmptyString(
      providerIdentityValue.calendarId,
      `item.reviewedSeries[${index.toString()}].providerIdentity.calendarId`,
    );
    const eventId = requireNonEmptyString(
      providerIdentityValue.eventId,
      `item.reviewedSeries[${index.toString()}].providerIdentity.eventId`,
    );
    const identityKey = `${calendarRole}\u0000${calendarId}\u0000${eventId}`;
    if (seen.has(identityKey)) {
      invalidInput(
        `item.reviewedSeries contains duplicate provider identity ${calendarId}/${eventId}`,
      );
    }
    seen.add(identityKey);
    const label =
      reviewed.label === undefined
        ? undefined
        : requireNonEmptyString(
            reviewed.label,
            `item.reviewedSeries[${index.toString()}].label`,
          );
    return {
      providerIdentity: { calendarRole, calendarId, eventId },
      ...(label === undefined ? {} : { label }),
    };
  });
  return { operation: "routine-migration", source, reviewedSeries };
}

function parseAcademicClass(
  value: unknown,
  index: number,
  timezone: "Asia/Singapore",
  seen: Set<string>,
): ParsedCalendarBulkCreateItem {
  const entry = requireObject(value, `item.classes[${index.toString()}]`);
  const prefix = `item.classes[${index.toString()}]`;
  const key = requireUniqueKey(entry.key, `${prefix}.key`, seen);
  const summary = requireNonEmptyString(entry.summary, `${prefix}.summary`);
  const weekday = parseNtuWeekday(entry.weekday, `${prefix}.weekday`);
  const startTime = requireTime(entry.startTime, `${prefix}.startTime`);
  const endTime = requireTime(entry.endTime, `${prefix}.endTime`);
  if (toMinutes(endTime) <= toMinutes(startTime)) {
    invalidInput(`${prefix}.endTime must be after ${prefix}.startTime`);
  }
  const weeks = parseNtuWeekSelection(entry.weeks, `${prefix}.weeks`);
  const schedule = ntuWeeklyClassSchedule({
    weekday,
    weeks,
    startTime,
    endTime,
  });
  const start = localNtuDateTime(schedule.startDate, startTime);
  const end = localNtuDateTime(schedule.startDate, endTime);
  const description = optionalString(
    entry.description,
    `${prefix}.description`,
  );
  const location = optionalString(entry.location, `${prefix}.location`);
  const recurring = !(
    "week" in weeks ||
    ("from" in weeks && weeks.from === weeks.to)
  );
  return {
    key,
    itemKind: "fixed-event",
    intendedEvent: {
      summary,
      visibility: "private",
      transparency: "opaque",
      ...(description === undefined ? {} : { description }),
      ...(location === undefined ? {} : { location }),
      ...(recurring ? { recurrence: schedule.recurrence } : {}),
      start: { dateTime: start, timeZone: timezone },
      end: { dateTime: end, timeZone: timezone },
    },
    occupiedIntervals: schedule.dates.map((date) => ({
      start: localNtuDateTime(date, startTime),
      end: localNtuDateTime(date, endTime),
    })),
  };
}

function parseAcademicExam(
  value: unknown,
  index: number,
  timezone: "Asia/Singapore",
  seen: Set<string>,
): ParsedCalendarBulkCreateItem {
  const entry = requireObject(value, `item.exams[${index.toString()}]`);
  const prefix = `item.exams[${index.toString()}]`;
  const key = requireUniqueKey(entry.key, `${prefix}.key`, seen);
  const summary = requireNonEmptyString(entry.summary, `${prefix}.summary`);
  const date = requireDate(entry.date, `${prefix}.date`);
  const startTime = requireTime(entry.startTime, `${prefix}.startTime`);
  const endTime = requireTime(entry.endTime, `${prefix}.endTime`);
  if (toMinutes(endTime) <= toMinutes(startTime)) {
    invalidInput(`${prefix}.endTime must be after ${prefix}.startTime`);
  }
  const description = optionalString(
    entry.description,
    `${prefix}.description`,
  );
  const location = optionalString(entry.location, `${prefix}.location`);
  return {
    key,
    itemKind: "fixed-event",
    intendedEvent: {
      summary,
      visibility: "private",
      transparency: "opaque",
      ...(description === undefined ? {} : { description }),
      ...(location === undefined ? {} : { location }),
      start: {
        dateTime: localNtuDateTime(date, startTime),
        timeZone: timezone,
      },
      end: { dateTime: localNtuDateTime(date, endTime), timeZone: timezone },
    },
    occupiedIntervals: [
      {
        start: localNtuDateTime(date, startTime),
        end: localNtuDateTime(date, endTime),
      },
    ],
  };
}

function parseSource(value: unknown): CalendarProposalSource {
  const source = requireObject(value, "source");
  return {
    kind: requireNonEmptyString(source.kind, "source.kind"),
    reference: requireNonEmptyString(source.reference, "source.reference"),
  };
}

function requireArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) invalidInput(`${name} must be an array`);
  return value;
}

function requireUniqueKey(
  value: unknown,
  name: string,
  seen: Set<string>,
): string {
  const key = requireNonEmptyString(value, name);
  if (seen.has(key)) invalidInput(`duplicate timetable event key ${key}`);
  seen.add(key);
  return key;
}

function parseNtuWeekday(value: unknown, name: string): NtuWeekday {
  if (
    value !== "MO" &&
    value !== "TU" &&
    value !== "WE" &&
    value !== "TH" &&
    value !== "FR"
  ) {
    invalidInput(`${name} must be one of MO, TU, WE, TH or FR`);
  }
  return value;
}

function parseNtuWeekSelection(value: unknown, name: string): NtuWeekSelection {
  if (value === undefined) return { from: 1, to: 13 };
  const selection = requireObject(value, name);
  if (selection.week !== undefined) {
    const week = requireTeachingWeek(selection.week, `${name}.week`);
    if (selection.from !== undefined || selection.to !== undefined) {
      invalidInput(`${name} must use either week or from/to`);
    }
    return { week };
  }
  const from = requireTeachingWeek(selection.from, `${name}.from`);
  const to = requireTeachingWeek(selection.to, `${name}.to`);
  if (from > to) invalidInput(`${name}.from must not exceed ${name}.to`);
  return { from, to };
}

function requireTeachingWeek(value: unknown, name: string): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 13
  ) {
    invalidInput(`${name} must be an integer from 1 to 13`);
  }
  return value as number;
}

function requireTime(value: unknown, name: string): string {
  const time = requireNonEmptyString(value, name);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)) {
    invalidInput(`${name} must be HH:mm`);
  }
  return time;
}

function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requireNonEmptyString(value, name);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function parseCalendarChangeProposalInput(
  value: unknown,
): ParsedCalendarActionProposalInput | undefined {
  if (
    !isObject(value) ||
    !isObject(value.item) ||
    (value.item.operation !== "update" &&
      value.item.operation !== "cancel" &&
      value.item.operation !== "restore")
  ) {
    return undefined;
  }
  const sourceValue = requireObject(value.source, "source");
  const source = {
    kind: requireNonEmptyString(sourceValue.kind, "source.kind"),
    reference: requireNonEmptyString(sourceValue.reference, "source.reference"),
  };
  const item = value.item;
  const calendarRole = requireRole(item.calendarRole);
  const eventId = requireNonEmptyString(item.eventId, "item.eventId");
  if (item.operation === "restore") {
    return { operation: "restore", source, calendarRole, eventId };
  }
  const recurrenceScope = parseRecurrenceScope(item.recurrenceScope);
  if (item.operation === "cancel") {
    return {
      operation: "cancel",
      source,
      calendarRole,
      eventId,
      ...(recurrenceScope === undefined ? {} : { recurrenceScope }),
    };
  }
  const targetCalendarRole =
    item.targetCalendarRole === undefined
      ? undefined
      : requireRole(item.targetCalendarRole);
  const patch = parseEventPatch(
    item.patch,
    targetCalendarRole !== undefined && targetCalendarRole !== calendarRole,
  );
  return {
    operation: "update",
    source,
    calendarRole,
    eventId,
    patch,
    ...(targetCalendarRole === undefined ? {} : { targetCalendarRole }),
    ...(recurrenceScope === undefined ? {} : { recurrenceScope }),
  };
}

function parseEventPatch(
  value: unknown,
  allowEmpty: boolean,
): CalendarEventPatch {
  const patch = requireObject(value, "item.patch");
  const allowed = new Set([
    "summary",
    "description",
    "location",
    "attachments",
    "reminders",
    "conferenceData",
    "source",
    "start",
    "end",
    "transparency",
    "visibility",
  ]);
  const keys = Object.keys(patch);
  if (
    (!allowEmpty && keys.length === 0) ||
    keys.some((key) => !allowed.has(key))
  ) {
    invalidInput("item.patch must contain only supported event fields");
  }
  return patch as CalendarEventPatch;
}

function parseRecurrenceScope(
  value: unknown,
): CalendarRecurrenceScope | undefined {
  if (value === undefined) return undefined;
  if (
    value !== "this-occurrence" &&
    value !== "entire-series" &&
    value !== "this-and-future"
  ) {
    invalidInput("item.recurrenceScope is not supported");
  }
  return value;
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
  const recurrence = parseEventRecurrence(input.item.recurrence);
  if (recurrence !== undefined && input.kind !== "routine-event") {
    invalidInput("item.recurrence is supported only for routine-event");
  }
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
      ...(recurrence === undefined ? {} : { recurrence }),
    },
    occupiedInterval: { start: start.dateTime, end: end.dateTime },
    travelBuffer: parseTravelBuffer(input.item.travelBuffer),
  };
}

function parseEventRecurrence(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (line) =>
        typeof line !== "string" ||
        line.trim() === "" ||
        line.includes("\n") ||
        line.includes("\r"),
    )
  ) {
    invalidInput("item.recurrence must contain non-empty single-line strings");
  }
  return value as string[];
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInput(message: string): never {
  throw new OperationalError(
    "invalid-target",
    `Invalid Calendar Proposal input: ${message}.`,
  );
}
