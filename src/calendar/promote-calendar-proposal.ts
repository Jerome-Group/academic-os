import { createHash } from "node:crypto";

import { OperationalError } from "../operational-error.js";
import {
  collectCalendarAvailability,
  findCalendarOverlaps,
} from "./calendar-conflicts.js";
import { calendarStateDigest } from "./create-calendar-proposal.js";
import type {
  CalendarProposal,
  CalendarEventPatch,
  CalendarProposalReader,
  CalendarProposalStore,
  CalendarPromotionJournal,
  CalendarRefreshReport,
  CalendarPromotionReport,
  CalendarPromotionWriter,
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
  const eventId =
    proposal.operation === "create"
      ? eventIdFor(proposal.idempotencyKey)
      : proposal.recurrenceScope === "this-and-future"
        ? eventIdFor(proposal.idempotencyKey)
        : proposal.recurrenceScope === "entire-series"
          ? (proposal.sourceItem.recurringEventId ??
            proposal.sourceItem.eventId)
          : proposal.sourceItem.eventId;
  const recorded = await input.journal.find(proposal.id);
  if (recorded !== undefined) {
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
  let verifiedEventId = eventId;
  try {
    verifiedEventId = await applyProposal(input.writer, proposal, eventId);
  } catch (error) {
    if (
      proposal.operation !== "create" &&
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
  proposal: CalendarProposal,
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
  proposal: CalendarProposal,
  eventId: string,
  calendarId: string,
  appendJournal: boolean,
): Promise<CalendarPromotionReport> {
  const verifiedEvent = await input.writer.readEvent({ calendarId, eventId });
  if (
    proposal.operation !== "create" &&
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

function eventContainsPatch(
  event: Awaited<ReturnType<CalendarPromotionWriter["readEvent"]>>,
  patch: CalendarEventPatch,
): boolean {
  return Object.entries(patch).every(
    ([key, value]) =>
      calendarStateDigest(event[key]) === calendarStateDigest(value),
  );
}

async function mirrorContainsVerifiedEvent(
  input: Pick<Parameters<typeof promoteCalendarProposal>[0], "mirrorStore">,
  proposal: CalendarProposal,
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
  proposal: CalendarProposal,
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
  proposal: CalendarProposal,
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
  if (proposal.operation !== "create") {
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
  proposal: CalendarProposal,
  eventId: string,
): Promise<string> {
  if (proposal.operation === "create") {
    await writer.createEvent({
      calendarId: proposal.target.calendarId,
      eventId,
      event: proposal.intendedEvent,
      idempotencyKey: proposal.idempotencyKey,
    });
    return eventId;
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
  verifiedEvent: Awaited<ReturnType<CalendarPromotionWriter["readEvent"]>>,
): CalendarPromotionReport {
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome,
    proposalId,
    verifiedEvent,
  };
}

function eventIdFor(idempotencyKey: string): string {
  return `a${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 31)}`;
}
