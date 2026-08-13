import { createHash } from "node:crypto";

import { OperationalError } from "../operational-error.js";
import { eventContainsPatch } from "./calendar-event-helpers.js";
import {
  collectCalendarAvailability,
  findCalendarOverlaps,
} from "./calendar-conflicts.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import { trimCalendarRecurrence } from "./calendar-recurrence.js";
import { promoteRoutineMigration } from "./promote-routine-migration.js";
import type {
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
  const eventId =
    proposal.operation === "create" || proposal.operation === "restore"
      ? eventIdFor(proposal.idempotencyKey)
      : proposal.operation === "cancel" &&
          proposal.recurrenceScope === "this-and-future"
        ? (proposal.recurringMaster?.id ?? proposal.sourceItem.eventId)
        : proposal.recurrenceScope === "this-and-future"
          ? eventIdFor(proposal.idempotencyKey)
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

function eventIdFor(idempotencyKey: string): string {
  return `a${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 31)}`;
}
