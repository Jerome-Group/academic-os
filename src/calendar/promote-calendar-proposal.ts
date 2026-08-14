import { OperationalError } from "../operational-error.js";
import { eventContainsPatch } from "./calendar-event-helpers.js";
import {
  collectCalendarAvailability,
  findCalendarOverlaps,
} from "./calendar-conflicts.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import { calendarEventIdFor } from "./calendar-idempotency.js";
import { trimCalendarRecurrence } from "./calendar-recurrence.js";
import { promoteRoutineMigration } from "./promote-routine-migration.js";
import type {
  CalendarBulkCreateItem,
  CalendarBulkCreateProposalCandidate,
  CalendarEvent,
  CalendarInterval,
  CalendarProposal,
  CalendarCancelProposalCandidate,
  CalendarChangeProposalCandidate,
  CalendarCreateProposalCandidate,
  CalendarEventPatch,
  CalendarProposalReader,
  CalendarProposalStore,
  CalendarPromotionJournal,
  CalendarRefreshReport,
  CalendarPromotionReport,
  CalendarPromotionWriter,
  CalendarRestoreProposalCandidate,
  OwnedCalendarMirrorStore,
  OwnedCalendarWorkspaceReader,
} from "./types.js";
import { OWNED_CALENDAR_ROLES } from "./types.js";

type PromotionInput = {
  proposalId: string;
  proposalStore: CalendarProposalStore;
  writer: CalendarPromotionWriter;
  journal: CalendarPromotionJournal;
  refresh: () => Promise<CalendarRefreshReport>;
  reader: CalendarProposalReader;
  workspaceReader: OwnedCalendarWorkspaceReader;
  mirrorStore: OwnedCalendarMirrorStore;
};

type NonRoutineCalendarProposal =
  | (CalendarCreateProposalCandidate & { status: "ready" })
  | (CalendarChangeProposalCandidate & { status: "ready" })
  | (CalendarCancelProposalCandidate & { status: "ready" })
  | (CalendarRestoreProposalCandidate & { status: "ready" });

type CalendarMoveProposal = CalendarChangeProposalCandidate & {
  status: "ready";
};

export async function promoteCalendarProposal(
  input: PromotionInput,
): Promise<CalendarPromotionReport> {
  const proposal = await input.proposalStore.read(input.proposalId);
  if (proposal === undefined) {
    throw new OperationalError(
      "invalid-target",
      "Calendar Promote requires an existing ready Proposal ID.",
    );
  }
  if (proposal.operation === "routine-migration") {
    return await promoteRoutineMigration(input, proposal);
  }
  if (proposal.operation === "bulk-create") {
    return await promoteBulkCalendarProposal(input, proposal);
  }
  const eventId =
    proposal.operation === "create" || proposal.operation === "restore"
      ? calendarEventIdFor(proposal.idempotencyKey)
      : proposal.operation === "cancel" &&
          proposal.recurrenceScope === "this-and-future"
        ? (proposal.recurringMaster?.id ?? proposal.sourceItem.eventId)
        : proposal.recurrenceScope === "this-and-future"
          ? calendarEventIdFor(proposal.idempotencyKey)
          : proposal.recurrenceScope === "entire-series"
            ? (proposal.sourceItem.recurringEventId ??
              proposal.sourceItem.eventId)
            : proposal.sourceItem.eventId;
  const recorded = await input.journal.find(proposal.id);
  if (recorded !== undefined) {
    if (proposal.operation === "cancel") {
      return await finalizeCancellation(
        input,
        proposal,
        recorded.eventId,
        false,
      );
    }
    return await finalizePromotion(
      input,
      proposal,
      recorded.eventId,
      recorded.calendarId ?? proposal.target.calendarId,
      false,
    );
  }
  if (proposal.status !== "ready") {
    throw new OperationalError(
      "invalid-target",
      "Calendar Promote requires an existing ready Proposal ID.",
    );
  }

  const refresh = await input.refresh();
  if (refresh.calendars.some(({ freshness }) => freshness === "stale")) {
    return blockedReport(proposal.id);
  }
  if (
    proposal.operation === "move" &&
    !(await sourceItemExists(input, proposal))
  ) {
    return await recoverInterruptedMove(input, proposal, eventId);
  }
  const validation = await validateProposal(proposal, input);
  if (validation === "stale") {
    await input.proposalStore.markStale(proposal.id, "live-version-changed");
    return {
      schemaVersion: 1,
      command: "calendar promote",
      outcome: "stale",
      proposalId: proposal.id,
    };
  }
  if (validation === "blocked") {
    return blockedReport(proposal.id);
  }
  if (proposal.operation === "cancel") {
    await applyCancellation(input.writer, proposal, eventId);
    return await finalizeCancellation(input, proposal, eventId, true);
  }
  let verifiedEventId = eventId;
  try {
    verifiedEventId = await applyProposal(input.writer, proposal, eventId);
  } catch (error) {
    if (
      proposal.operation !== "create" &&
      proposal.operation !== "restore" &&
      proposal.recurrenceScope === "this-and-future"
    ) {
      throw error;
    }
    try {
      const acceptedEvent = await input.writer.readEvent({
        calendarId: proposal.target.calendarId,
        eventId: verifiedEventId,
      });
      if (
        proposal.operation !== "create" &&
        proposal.operation !== "restore" &&
        !eventContainsPatch(acceptedEvent, proposal.patch)
      ) {
        throw error;
      }
    } catch {
      throw error;
    }
  }
  return await finalizePromotion(
    input,
    proposal,
    verifiedEventId,
    proposal.target.calendarId,
    true,
  );
}

async function promoteBulkCalendarProposal(
  input: PromotionInput,
  proposal: CalendarBulkCreateProposalCandidate & { status: "ready" },
): Promise<CalendarPromotionReport> {
  const recorded = await input.journal.find(proposal.id);
  if (recorded !== undefined) {
    const eventIds = recorded.eventIds ?? [recorded.eventId];
    const verifiedEvents = await readBulkEvents(
      input.writer,
      proposal.target.calendarId,
      eventIds,
    );
    if (verifiedEvents === undefined) return blockedReport(proposal.id);
    return await finalizeBulkPromotion(
      input,
      proposal,
      eventIds,
      verifiedEvents,
      false,
    );
  }
  if (proposal.status !== "ready") {
    throw new OperationalError(
      "invalid-target",
      "Calendar Promote requires an existing ready Proposal ID.",
    );
  }

  const refresh = await input.refresh();
  if (refresh.calendars.some(({ freshness }) => freshness === "stale")) {
    return blockedReport(proposal.id);
  }
  const validation = await validateBulkProposal(proposal, input);
  if (validation === "stale") {
    await input.proposalStore.markStale(proposal.id, "live-version-changed");
    return {
      schemaVersion: 1,
      command: "calendar promote",
      outcome: "stale",
      proposalId: proposal.id,
    };
  }
  if (validation === "blocked") return blockedReport(proposal.id);

  const eventIds = proposal.items.map(({ eventId }) => eventId);
  const verifiedEvents: CalendarEvent[] = [];
  for (const item of proposal.items) {
    const eventId = item.eventId;
    try {
      await input.writer.createEvent({
        calendarId: proposal.target.calendarId,
        eventId,
        event: item.intendedEvent,
        idempotencyKey: item.idempotencyKey,
      });
    } catch (error) {
      const accepted = await readBulkEventAfterCreateFailure(
        input.writer,
        proposal.target.calendarId,
        eventId,
      );
      if (
        accepted === undefined ||
        !eventMatchesIntended(accepted, item.intendedEvent)
      ) {
        throw error;
      }
    }
    const verified = await input.writer.readEvent({
      calendarId: proposal.target.calendarId,
      eventId,
    });
    if (!eventMatchesIntended(verified, item.intendedEvent)) {
      throw new OperationalError(
        "operational-failure",
        `Calendar Promotion read back an unexpected event for ${item.key}.`,
      );
    }
    verifiedEvents.push(verified);
  }
  return await finalizeBulkPromotion(
    input,
    proposal,
    eventIds,
    verifiedEvents,
    true,
  );
}

async function finalizeBulkPromotion(
  input: PromotionInput,
  proposal: CalendarBulkCreateProposalCandidate & { status: "ready" },
  eventIds: string[],
  verifiedEvents: CalendarEvent[],
  appendJournal: boolean,
): Promise<CalendarPromotionReport> {
  if (eventIds.length === 0 || verifiedEvents.length !== eventIds.length) {
    return blockedReport(proposal.id);
  }
  const appended = appendJournal
    ? await input.journal.appendOnce({
        schemaVersion: 1,
        proposalId: proposal.id,
        eventId: eventIds[0] as string,
        eventIds,
        idempotencyKey: proposal.idempotencyKey,
        calendarId: proposal.target.calendarId,
      })
    : false;
  const refreshed = await input.refresh();
  if (
    refreshed.calendars.some(({ freshness }) => freshness === "stale") ||
    !(await mirrorContainsBulkEvents(input, proposal, eventIds))
  ) {
    return blockedReport(proposal.id);
  }
  await input.proposalStore.markPromoted(proposal.id);
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome: appended ? "promoted" : "retry",
    proposalId: proposal.id,
    verifiedEvents,
  };
}

async function validateBulkProposal(
  proposal: CalendarBulkCreateProposalCandidate & { status: "ready" },
  input: Pick<PromotionInput, "reader" | "workspaceReader" | "mirrorStore">,
): Promise<"valid" | "stale" | "blocked"> {
  const workspace = await input.workspaceReader.read();
  const calendars = await input.reader.listCalendars();
  const target = calendars.find(({ id }) => id === proposal.target.calendarId);
  if (target?.etag !== proposal.targetCalendarVersion.etag) return "stale";
  const mirrors = [];
  for (const role of OWNED_CALENDAR_ROLES) {
    const mirror = await input.mirrorStore.read(role);
    if (mirror === undefined || mirror.freshness === "stale") return "blocked";
    mirrors.push(mirror);
  }
  const interval = boundingInterval(
    proposal.relevantAvailabilityVersion.intervals,
  );
  const availability = await collectCalendarAvailability({
    reader: input.reader,
    calendars,
    mirrors,
    ownedCalendarIds: workspace.ownedCalendarIds,
    interval,
  });
  const proposalEventIds = new Set(
    proposal.items.map(({ eventId }) => eventId),
  );
  const relevantAvailability = availability.items.filter(
    ({ event }) =>
      !proposalEventIds.has(event.id) &&
      !proposalEventIds.has(event.recurringEventId ?? ""),
  );
  const availabilityDigest = calendarStateDigest(
    relevantAvailability.map(({ calendarId, event }) => ({
      calendarId,
      event,
    })),
  );
  if (
    availabilityDigest !== proposal.relevantAvailabilityVersion.digest ||
    availability.checkedCalendarCount !==
      proposal.relevantAvailabilityVersion.checkedCalendarCount
  ) {
    const blockers = bulkConflicts(proposal.items, relevantAvailability);
    return blockers.length > 0 ? "blocked" : "stale";
  }
  return "valid";
}

function bulkConflicts(
  items: CalendarBulkCreateItem[],
  availability: Parameters<typeof findCalendarOverlaps>[0]["availability"],
) {
  const seen = new Set<string>();
  return items.flatMap((item) =>
    item.occupiedIntervals.flatMap((interval) =>
      findCalendarOverlaps({
        availability,
        interval,
        proposedKind: item.itemKind,
      }).filter((overlap) => {
        const key = `${item.key}\0${overlap.eventId}\0${overlap.start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return overlap.severity === "block";
      }),
    ),
  );
}

async function readBulkEvents(
  writer: CalendarPromotionWriter,
  calendarId: string,
  eventIds: string[],
): Promise<CalendarEvent[] | undefined> {
  const events: CalendarEvent[] = [];
  for (const eventId of eventIds) {
    try {
      events.push(await writer.readEvent({ calendarId, eventId }));
    } catch (error) {
      if (isMissingEventError(error)) return undefined;
      throw error;
    }
  }
  return events;
}

async function readBulkEventAfterCreateFailure(
  writer: CalendarPromotionWriter,
  calendarId: string,
  eventId: string,
): Promise<CalendarEvent | undefined> {
  try {
    return await writer.readEvent({ calendarId, eventId });
  } catch (error) {
    if (isMissingEventError(error)) return undefined;
    throw error;
  }
}

async function mirrorContainsBulkEvents(
  input: Pick<PromotionInput, "mirrorStore">,
  proposal: CalendarBulkCreateProposalCandidate,
  eventIds: string[],
): Promise<boolean> {
  const mirror = await input.mirrorStore.read(proposal.target.calendarRole);
  return (
    mirror !== undefined &&
    eventIds.every((eventId) =>
      mirror.items.some(({ event }) => event.id === eventId),
    )
  );
}

function eventMatchesIntended(
  event: CalendarEvent,
  intended: CalendarBulkCreateItem["intendedEvent"],
): boolean {
  const actual = event as Record<string, unknown>;
  return (
    actual.summary === intended.summary &&
    actual.visibility === intended.visibility &&
    transparencyMatches(actual.transparency, intended.transparency) &&
    optionalStringMatches(actual.description, intended.description) &&
    optionalStringMatches(actual.location, intended.location) &&
    recurrenceMatches(actual.recurrence, intended.recurrence) &&
    calendarPointMatches(actual.start, intended.start) &&
    calendarPointMatches(actual.end, intended.end)
  );
}

function optionalStringMatches(
  actual: unknown,
  expected: string | undefined,
): boolean {
  return expected === undefined || actual === expected;
}

function transparencyMatches(
  actual: unknown,
  expected: "opaque" | "transparent",
): boolean {
  return (
    (actual === undefined || actual === null ? "opaque" : actual) === expected
  );
}

function recurrenceMatches(
  actual: unknown,
  expected: string[] | undefined,
): boolean {
  if (expected === undefined) return true;
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const actualLines = actual.filter(
    (line): line is string => typeof line === "string",
  );
  if (actualLines.length !== expected.length) return false;
  const expectedLines = [...expected].sort();
  return [...actualLines]
    .sort()
    .every((line, index) => line === expectedLines[index]);
}

function calendarPointMatches(
  actual: unknown,
  expected: { date: string } | { dateTime: string; timeZone: string },
): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  const point = actual as {
    date?: unknown;
    dateTime?: unknown;
    timeZone?: unknown;
  };
  if ("date" in expected) return point.date === expected.date;
  if (typeof point.dateTime !== "string") return false;
  const expectedInstant = Date.parse(expected.dateTime);
  const actualInstant = Date.parse(point.dateTime);
  return (
    Number.isFinite(expectedInstant) &&
    actualInstant === expectedInstant &&
    (point.timeZone === undefined || point.timeZone === expected.timeZone)
  );
}

function boundingInterval(intervals: CalendarInterval[]): CalendarInterval {
  const first = intervals[0];
  if (first === undefined) {
    throw new OperationalError(
      "invalid-target",
      "An academic timetable Proposal must contain an occupied interval.",
    );
  }
  return intervals.reduce(
    (result, interval) => ({
      start:
        Date.parse(interval.start) < Date.parse(result.start)
          ? interval.start
          : result.start,
      end:
        Date.parse(interval.end) > Date.parse(result.end)
          ? interval.end
          : result.end,
    }),
    first,
  );
}

function isMissingEventError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as {
    code?: number | string;
    response?: { status?: number };
  };
  return value.response?.status === 404 || value.code === 404;
}

async function recoverInterruptedMove(
  input: PromotionInput,
  proposal: CalendarMoveProposal,
  eventId: string,
): Promise<CalendarPromotionReport> {
  if (proposal.operation !== "move") return blockedReport(proposal.id);
  try {
    await input.writer.readEvent({
      calendarId: proposal.target.calendarId,
      eventId,
    });
  } catch {
    return await markProposalStale(input.proposalStore, proposal.id);
  }
  if (Object.keys(proposal.patch).length > 0) {
    await input.writer.patchEvent({
      calendarId: proposal.target.calendarId,
      eventId,
      patch: proposal.patch,
    });
  }
  return await finalizePromotion(
    input,
    proposal,
    eventId,
    proposal.target.calendarId,
    true,
  );
}

async function finalizePromotion(
  input: PromotionInput,
  proposal: NonRoutineCalendarProposal,
  eventId: string,
  calendarId: string,
  appendJournal: boolean,
): Promise<CalendarPromotionReport> {
  if (proposal.operation === "cancel") return blockedReport(proposal.id);
  const verifiedEvent = await input.writer.readEvent({ calendarId, eventId });
  if (
    proposal.operation !== "create" &&
    proposal.operation !== "restore" &&
    !eventContainsPatch(verifiedEvent, proposal.patch)
  ) {
    return blockedReport(proposal.id);
  }
  const appended = appendJournal
    ? await input.journal.appendOnce({
        schemaVersion: 1,
        proposalId: proposal.id,
        eventId,
        idempotencyKey: proposal.idempotencyKey,
        calendarId,
      })
    : false;
  const refreshed = await input.refresh();
  if (
    refreshed.calendars.some(({ freshness }) => freshness === "stale") ||
    !(await mirrorContainsVerifiedEvent(input, proposal, verifiedEvent))
  ) {
    return blockedReport(proposal.id);
  }
  await input.proposalStore.markPromoted(proposal.id);
  return report(appended ? "promoted" : "retry", proposal.id, verifiedEvent);
}

async function finalizeCancellation(
  input: PromotionInput,
  proposal: Extract<CalendarProposal, { operation: "cancel" }>,
  eventId: string,
  appendJournal: boolean,
): Promise<CalendarPromotionReport> {
  const appended = appendJournal
    ? await input.journal.appendOnce({
        schemaVersion: 1,
        proposalId: proposal.id,
        eventId,
        idempotencyKey: proposal.idempotencyKey,
        calendarId: proposal.sourceItem.calendarId,
      })
    : false;
  const refreshed = await input.refresh();
  let mirror = await input.mirrorStore.read(proposal.sourceItem.calendarRole);
  if (
    proposal.recurrenceScope === "this-and-future" &&
    mirror !== undefined &&
    !mirror.tombstones.some(
      ({ event }) => event.id === proposal.preview.event.id,
    )
  ) {
    mirror = {
      ...mirror,
      tombstones: [
        ...mirror.tombstones,
        {
          access: "owned",
          deletedAt: mirror.lastSuccessfulRefresh ?? new Date().toISOString(),
          event: proposal.preview.event,
        },
      ],
    };
    await input.mirrorStore.write(mirror);
  }
  const deleted =
    proposal.recurrenceScope === "this-and-future"
      ? mirror?.items.some(({ event }) => event.id === eventId) === true &&
        mirror.tombstones.some(
          ({ event }) => event.id === proposal.preview.event.id,
        )
      : mirror?.tombstones.some(({ event }) => event.id === eventId) === true;
  if (
    refreshed.calendars.some(({ freshness }) => freshness === "stale") ||
    !deleted
  ) {
    return blockedReport(proposal.id);
  }
  await input.proposalStore.markPromoted(proposal.id);
  return report(appended ? "promoted" : "retry", proposal.id);
}

async function markProposalStale(
  store: CalendarProposalStore,
  proposalId: string,
): Promise<CalendarPromotionReport> {
  await store.markStale(proposalId, "live-version-changed");
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome: "stale",
    proposalId,
  };
}

async function mirrorContainsVerifiedEvent(
  input: Pick<Parameters<typeof promoteCalendarProposal>[0], "mirrorStore">,
  proposal: NonRoutineCalendarProposal,
  verifiedEvent: Awaited<ReturnType<CalendarPromotionWriter["readEvent"]>>,
): Promise<boolean> {
  const currentMirror = await input.mirrorStore.read(
    proposal.target.calendarRole,
  );
  const currentEvent = currentMirror?.items.find(
    ({ event }) => event.id === verifiedEvent.id,
  )?.event;
  return (
    currentEvent !== undefined &&
    calendarStateDigest(currentEvent) === calendarStateDigest(verifiedEvent)
  );
}

async function sourceItemExists(
  input: Pick<Parameters<typeof promoteCalendarProposal>[0], "mirrorStore">,
  proposal: CalendarMoveProposal,
): Promise<boolean> {
  if (proposal.operation !== "move") return false;
  const mirror = await input.mirrorStore.read(proposal.sourceItem.calendarRole);
  return (
    mirror?.items.some(
      ({ event }) => event.id === proposal.sourceItem.eventId,
    ) === true
  );
}

function blockedReport(proposalId: string): CalendarPromotionReport {
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome: "blocked",
    proposalId,
  };
}

async function validateProposal(
  proposal: NonRoutineCalendarProposal,
  input: Pick<
    Parameters<typeof promoteCalendarProposal>[0],
    "reader" | "workspaceReader" | "mirrorStore"
  >,
): Promise<"valid" | "stale" | "blocked"> {
  const workspace = await input.workspaceReader.read();
  const calendars = await input.reader.listCalendars();
  if (proposal.operation === "create") {
    const target = calendars.find(
      ({ id }) => id === proposal.target.calendarId,
    );
    if (target?.etag !== proposal.targetCalendarVersion.etag) return "stale";
  }
  const mirrors = [];
  for (const role of OWNED_CALENDAR_ROLES) {
    const mirror = await input.mirrorStore.read(role);
    if (mirror === undefined || mirror.freshness === "stale") return "blocked";
    mirrors.push(mirror);
  }
  if (proposal.operation === "restore") {
    const mirror = mirrors.find(
      ({ role }) => role === proposal.restoredFrom.calendarRole,
    );
    const tombstone = mirror?.tombstones.find(
      ({ event, deletedAt }) =>
        event.id === proposal.restoredFrom.eventId &&
        deletedAt === proposal.restoredFrom.deletedAt,
    );
    if (tombstone === undefined) return "stale";
  }
  if (proposal.operation !== "create" && proposal.operation !== "restore") {
    const sourceMirror = mirrors.find(
      ({ role }) => role === proposal.sourceItem.calendarRole,
    );
    const current = sourceMirror?.items.find(
      ({ event }) => event.id === proposal.sourceItem.eventId,
    )?.event;
    if (
      current === undefined ||
      calendarStateDigest(current) !== proposal.sourceItem.versionDigest
    ) {
      return "stale";
    }
    for (const dependency of proposal.recurrenceDependencies ?? []) {
      const dependentEvent = sourceMirror?.items.find(
        ({ event }) => event.id === dependency.eventId,
      )?.event;
      const digest =
        dependentEvent === undefined
          ? undefined
          : calendarStateDigest(dependentEvent);
      if (
        digest !== dependency.versionDigest &&
        digest !== dependency.acceptedTrimmedDigest
      ) {
        return "stale";
      }
    }
  }
  const interval = proposal.relevantAvailabilityVersion.interval;
  const availability =
    interval === null
      ? { items: [], checkedCalendarCount: 0 }
      : await collectCalendarAvailability({
          reader: input.reader,
          calendars,
          mirrors,
          ownedCalendarIds: workspace.ownedCalendarIds,
          interval,
        });
  const relevantAvailability = availability.items.filter(
    ({ calendarId, event }) =>
      proposal.operation === "create" ||
      proposal.operation === "restore" ||
      calendarId !== proposal.sourceItem.calendarId ||
      (event.id !== proposal.sourceItem.eventId &&
        event.id !== proposal.sourceItem.recurringEventId),
  );
  const availabilityDigest = calendarStateDigest(
    relevantAvailability.map(({ calendarId, event }) => ({
      calendarId,
      event,
    })),
  );
  if (
    availabilityDigest !== proposal.relevantAvailabilityVersion.digest ||
    availability.checkedCalendarCount !==
      proposal.relevantAvailabilityVersion.checkedCalendarCount
  ) {
    const blockers = findCalendarOverlaps({
      availability: relevantAvailability,
      interval,
      proposedKind: proposal.itemKind,
    }).filter(({ severity }) => severity === "block");
    return blockers.length > 0 ? "blocked" : "stale";
  }
  return "valid";
}

async function applyProposal(
  writer: CalendarPromotionWriter,
  proposal: NonRoutineCalendarProposal,
  eventId: string,
): Promise<string> {
  if (proposal.operation === "create" || proposal.operation === "restore") {
    await writer.createEvent({
      calendarId: proposal.target.calendarId,
      eventId,
      event: proposal.intendedEvent,
      idempotencyKey: proposal.idempotencyKey,
    });
    return eventId;
  }
  if (proposal.operation === "cancel") {
    throw new Error("Cancellation uses its dedicated Promotion path.");
  }
  if (proposal.recurrenceScope === "this-and-future") {
    const recurringEventId = proposal.sourceItem.recurringEventId;
    const recurringMaster = proposal.recurringMaster;
    if (recurringEventId === undefined || recurringMaster === undefined) {
      throw new OperationalError(
        "invalid-target",
        "This-and-future Promotion requires a recurring occurrence.",
      );
    }
    return (
      await writer.splitRecurringEvent({
        sourceCalendarId: proposal.sourceItem.calendarId,
        targetCalendarId: proposal.target.calendarId,
        instanceId: proposal.sourceItem.eventId,
        recurringEventId,
        patch: proposal.patch,
        idempotencyKey: proposal.idempotencyKey,
        exceptions: proposal.recurrenceExceptions ?? [],
        recurringMaster,
      })
    ).eventId;
  }
  const patchCalendarId =
    proposal.operation === "move"
      ? proposal.target.calendarId
      : proposal.sourceItem.calendarId;
  if (proposal.operation === "move") {
    await writer.moveEvent({
      sourceCalendarId: proposal.sourceItem.calendarId,
      targetCalendarId: proposal.target.calendarId,
      eventId,
    });
  }
  if (Object.keys(proposal.patch).length > 0) {
    await writer.patchEvent({
      calendarId: patchCalendarId,
      eventId,
      patch: proposal.patch,
    });
  }
  return eventId;
}

function report(
  outcome: "promoted" | "retry",
  proposalId: string,
  verifiedEvent?: Awaited<ReturnType<CalendarPromotionWriter["readEvent"]>>,
): CalendarPromotionReport {
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome,
    proposalId,
    ...(verifiedEvent === undefined ? {} : { verifiedEvent }),
  };
}

async function applyCancellation(
  writer: CalendarPromotionWriter,
  proposal: Extract<CalendarProposal, { operation: "cancel" }>,
  eventId: string,
): Promise<void> {
  if (proposal.recurrenceScope === "this-and-future") {
    const master = proposal.recurringMaster;
    const boundary =
      proposal.preview.event.originalStartTime?.dateTime ??
      proposal.preview.event.originalStartTime?.date ??
      proposal.preview.event.start?.dateTime ??
      proposal.preview.event.start?.date;
    if (master?.recurrence === undefined || boundary === undefined) {
      throw new OperationalError(
        "invalid-target",
        "This-and-future cancellation requires its recurring master.",
      );
    }
    await writer.patchEvent({
      calendarId: proposal.sourceItem.calendarId,
      eventId: master.id,
      patch: {
        recurrence: trimCalendarRecurrence(master.recurrence, boundary),
      } as CalendarEventPatch,
    });
    return;
  }
  await writer.deleteEvent({
    calendarId: proposal.sourceItem.calendarId,
    eventId,
  });
}
