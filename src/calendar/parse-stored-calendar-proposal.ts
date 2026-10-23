import { OperationalError } from "../operational-error.js";
import {
  isCalendarEvent,
  isCalendarEventContent,
} from "./calendar-event-helpers.js";
import { parseEventPatch } from "./calendar-proposal-input.js";
import type { CalendarAssessmentReview } from "./calendar-occupancy.js";
import type { CalendarStoredProposal, OwnedCalendarRole } from "./types.js";

export function parseStoredCalendarProposal(
  value: unknown,
): CalendarStoredProposal {
  if (!isStoredCalendarProposal(value)) invalid();
  return value;
}

function isStoredCalendarProposal(
  value: unknown,
): value is CalendarStoredProposal {
  if (
    !isRecord(value) ||
    !nonempty(value.id) ||
    !nonempty(value.idempotencyKey) ||
    !["ready", "stale", "promoted"].includes(String(value.status)) ||
    !isRecord(value.source) ||
    !nonempty(value.source.kind) ||
    !nonempty(value.source.reference) ||
    !target(value.target) ||
    ![
      "fixed-event",
      "routine-event",
      "timed-milestone",
      "all-day-milestone",
    ].includes(String(value.itemKind)) ||
    !Array.isArray(value.liveVersions) ||
    !isRecord(value.relevantAvailabilityVersion) ||
    !nonempty(value.relevantAvailabilityVersion.digest) ||
    !isRecord(value.conflictSummary) ||
    !nonnegative(value.conflictSummary.blockers) ||
    !nonnegative(value.conflictSummary.warnings)
  )
    invalid();
  if (value.review !== undefined && !isCalendarAssessmentReview(value.review))
    invalid();
  if (value.operation === "create") {
    if (
      !intended(value.intendedEvent) ||
      !isRecord(value.inheritedDefaults) ||
      !isRecord(value.targetCalendarVersion) ||
      !nonempty(value.targetCalendarVersion.calendarId) ||
      !nonempty(value.targetCalendarVersion.etag)
    )
      invalid();
    if (
      value.travelBuffer !== undefined &&
      (!isRecord(value.travelBuffer) ||
        !nonnegative(value.travelBuffer.beforeMinutes) ||
        !nonnegative(value.travelBuffer.afterMinutes))
    )
      invalid();
  } else if (value.operation === "restore") {
    if (
      !isCalendarEventContent(value.intendedEvent) ||
      !isRecord(value.restoredFrom) ||
      !role(value.restoredFrom.calendarRole) ||
      !nonempty(value.restoredFrom.eventId) ||
      !nonempty(value.restoredFrom.deletedAt)
    )
      invalid();
  } else if (value.operation === "bulk-create") {
    if (
      !Array.isArray(value.items) ||
      value.items.length === 0 ||
      !value.items.every(
        (item) =>
          isRecord(item) &&
          nonempty(item.key) &&
          nonempty(item.eventId) &&
          nonempty(item.idempotencyKey) &&
          item.itemKind === "fixed-event" &&
          intended(item.intendedEvent) &&
          Array.isArray(item.occupiedIntervals),
      ) ||
      !isRecord(value.inheritedDefaults) ||
      !isRecord(value.targetCalendarVersion) ||
      !nonempty(value.targetCalendarVersion.calendarId) ||
      !nonempty(value.targetCalendarVersion.etag)
    )
      invalid();
  } else if (
    value.operation === "update" ||
    value.operation === "move" ||
    value.operation === "cancel"
  ) {
    if (
      !sourceItem(value.sourceItem) ||
      (value.recurrenceScope !== undefined &&
        !["this-occurrence", "entire-series", "this-and-future"].includes(
          String(value.recurrenceScope),
        ))
    )
      invalid();
    if (value.operation === "cancel") {
      if (!isRecord(value.preview) || !isCalendarEvent(value.preview.event))
        invalid();
    } else parseEventPatch(value.patch, value.operation === "move");
    if (
      value.recurringMaster !== undefined &&
      !isCalendarEvent(value.recurringMaster)
    )
      invalid();
    if (
      value.recurringOccurrence !== undefined &&
      !isCalendarEvent(value.recurringOccurrence)
    )
      invalid();
    if (
      value.recurrenceExceptions !== undefined &&
      (!Array.isArray(value.recurrenceExceptions) ||
        !value.recurrenceExceptions.every(isCalendarEvent))
    )
      invalid();
    if (
      value.recurrenceDependencies !== undefined &&
      (!Array.isArray(value.recurrenceDependencies) ||
        !value.recurrenceDependencies.every(
          (dependency) =>
            isRecord(dependency) &&
            nonempty(dependency.eventId) &&
            nonempty(dependency.versionDigest) &&
            (dependency.acceptedTrimmedDigest === undefined ||
              nonempty(dependency.acceptedTrimmedDigest)),
        ))
    )
      invalid();
  } else if (value.operation === "routine-migration") {
    if (
      !Array.isArray(value.moves) ||
      !value.moves.every(
        (move) =>
          isRecord(move) &&
          sourceItem(move.sourceItem) &&
          target(move.target) &&
          move.recurrenceScope === "entire-series" &&
          isCalendarEvent(move.recurringMaster) &&
          Array.isArray(move.recurrenceExceptions) &&
          move.recurrenceExceptions.every(isCalendarEvent) &&
          Array.isArray(move.seriesEventIds) &&
          move.seriesEventIds.every(nonempty) &&
          validPatch(move.patch),
      ) ||
      !Array.isArray(value.completed) ||
      !Array.isArray(value.decisions)
    )
      invalid();
  } else invalid();
  return true;
}

function isCalendarAssessmentReview(
  value: unknown,
): value is CalendarAssessmentReview {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    !digest(value.intentDigest) ||
    !digest(value.planDigest) ||
    !digest(value.binding) ||
    !Array.isArray(value.originals) ||
    !value.originals.every(
      (original) =>
        isRecord(original) &&
        ref(original.ref) &&
        isCalendarEvent(original.event) &&
        original.event.id === original.ref.eventId,
    ) ||
    !Array.isArray(value.inventories) ||
    !value.inventories.every(
      (inventory) =>
        isRecord(inventory) &&
        ref(inventory.ref) &&
        Array.isArray(inventory.events) &&
        inventory.events.every(isCalendarEvent),
    ) ||
    !isRecord(value.coverage) ||
    !["complete-finite", "not-required"].includes(
      String(value.coverage.kind),
    ) ||
    !["complete-finite", "anchor-only", "not-enumerated"].includes(
      String(value.coverage.warningCoverage),
    ) ||
    !Array.isArray(value.coverage.occurrences) ||
    !value.coverage.occurrences.every(
      (occupant) =>
        isRecord(occupant) &&
        nonempty(occupant.key) &&
        nonempty(occupant.originalStart) &&
        role(occupant.role) &&
        interval(occupant.interval),
    ) ||
    !isRecord(value.engine) ||
    !nonempty(value.engine.expansion) ||
    !nonempty(value.engine.node) ||
    !nonempty(value.engine.icu) ||
    !nonempty(value.engine.tz)
  )
    return false;
  if (
    value.coverage.kind === "not-required" &&
    !["cancellation", "milestone", "routine", "occupancy-preserving"].includes(
      String(value.coverage.reason),
    )
  )
    return false;
  return true;
}
function intended(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.summary === "string" &&
    value.visibility === "private" &&
    (value.transparency === "opaque" || value.transparency === "transparent") &&
    value.start !== undefined &&
    value.end !== undefined &&
    isCalendarEventContent(value)
  );
}
function validPatch(value: unknown): boolean {
  try {
    parseEventPatch(value, true);
    return true;
  } catch {
    return false;
  }
}
function sourceItem(value: unknown): boolean {
  return (
    target(value) &&
    nonempty(value.eventId) &&
    nonempty(value.versionDigest) &&
    (value.recurringEventId === undefined || nonempty(value.recurringEventId))
  );
}
function target(value: unknown): value is Record<string, unknown> & {
  calendarId: string;
  calendarRole: OwnedCalendarRole;
} {
  return (
    isRecord(value) && role(value.calendarRole) && nonempty(value.calendarId)
  );
}
function ref(value: unknown): value is { calendarId: string; eventId: string } {
  return (
    isRecord(value) && nonempty(value.calendarId) && nonempty(value.eventId)
  );
}
function interval(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonempty(value.start) &&
    nonempty(value.end) &&
    Number.isFinite(Date.parse(value.start)) &&
    Date.parse(value.end) > Date.parse(value.start)
  );
}
function role(value: unknown): value is OwnedCalendarRole {
  return value === "Academic" || value === "Commitments" || value === "Routine";
}
function digest(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalid(): never {
  throw new OperationalError(
    "operational-failure",
    "The private pending Calendar Proposal is invalid; re-preview required.",
  );
}
