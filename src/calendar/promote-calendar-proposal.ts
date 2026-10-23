import { OperationalError } from "../operational-error.js";
import {
  assessCalendarProposal,
  calendarContentMatches,
  type CalendarAssessment,
} from "./calendar-occupancy.js";
import { readCurrentCalendarMirrors } from "./read-current-calendar-mirrors.js";
import {
  eventContainsPatch,
  restorableEvent,
} from "./calendar-event-helpers.js";
import { calendarEventIdFor } from "./calendar-idempotency.js";
import type {
  CalendarEvent,
  CalendarStoredProposal,
  CalendarProposalReader,
  CalendarProposalStore,
  CalendarPromotionJournal,
  CalendarRefreshReport,
  CalendarPromotionReport,
  CalendarPromotionWriter,
  OwnedCalendarMirrorStore,
  OwnedCalendarWorkspaceReader,
} from "./types.js";

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
  if (proposal === undefined)
    throw new OperationalError(
      "invalid-target",
      "Calendar Promote requires an existing ready Proposal ID.",
    );
  const recorded = await input.journal.find(proposal.id);
  if (
    recorded !== undefined &&
    (recorded.idempotencyKey !== proposal.idempotencyKey ||
      recorded.proposalId !== proposal.id ||
      (recorded.calendarId !== undefined &&
        recorded.calendarId !== proposal.target.calendarId))
  )
    return refused(
      proposal.id,
      "blocked",
      "Promotion receipt does not match the exact Calendar identity and intent.",
    );
  if (recorded === undefined && proposal.review?.schemaVersion !== 2)
    return stale(
      input,
      proposal.id,
      "Legacy Calendar Proposal requires re-preview. Its saved intervals, digest and counts cannot authorize publication.",
    );
  if (recorded === undefined && proposal.status !== "ready")
    throw new OperationalError(
      "invalid-target",
      "Calendar Promote requires an existing ready Proposal ID.",
    );
  if (recorded !== undefined && proposal.review?.schemaVersion !== 2)
    return await finalizeLegacyReceipt(
      input,
      proposal,
      recorded.eventIds ?? [recorded.eventId],
    );
  const refreshed = await input.refresh();
  if (refreshed.calendars.some(({ freshness }) => freshness === "stale"))
    return refused(
      proposal.id,
      "blocked",
      "Calendar Refresh must succeed before publication.",
    );
  const workspace = await input.workspaceReader.read();
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    workspace,
  );
  if (
    recorded === undefined &&
    proposal.operation === "cancel" &&
    proposal.recurrenceScope !== "this-and-future" &&
    !mirrors.some(
      (mirror) =>
        mirror.calendarId === proposal.sourceItem.calendarId &&
        mirror.items.some(
          ({ event }) => event.id === proposal.sourceItem.eventId,
        ),
    )
  )
    return stale(
      input,
      proposal.id,
      "The live item was deleted before an unrecorded cancellation; reconcile the retained tombstone.",
    );
  const reader: CalendarProposalReader = {
    ...input.reader,
    readEvent: input.reader.readEvent ?? input.writer.readEvent,
  };
  const assess = async () =>
    await assessCalendarProposal({
      proposal,
      workspace,
      mirrors,
      reader,
      promotion: true,
      ...(recorded === undefined ? {} : { completed: true }),
    });
  let assessment = await assess();
  while (assessment.outcome === "ready" && assessment.remainingStepCount > 0) {
    const accepted = assessment.acceptedStepCount;
    try {
      await assessment.executeNext(input.writer);
    } catch (error) {
      const afterFailure = await assess();
      if (afterFailure.outcome !== "ready")
        return {
          ...assessmentReport(proposal.id, afterFailure),
          outcome: "blocked",
          reason:
            "Provider call failed and current state cannot authorize another write; reconcile the existing effects. " +
            afterFailure.reason,
        };
      if (afterFailure.acceptedStepCount <= accepted)
        throw new OperationalError(
          "operational-failure",
          `Calendar provider write failed with ${accepted} accepted plan steps retained; no further writes attempted. ${error instanceof Error ? error.message : "Reconcile provider state before retrying."}`,
        );
      assessment = afterFailure;
      continue;
    }
    assessment = await assess();
    if (assessment.outcome === "stale")
      return {
        ...assessmentReport(proposal.id, assessment),
        outcome: "blocked",
        reason:
          "Provider readback differs from the exact assessed write; reconcile the existing effects before further publication.",
      };
    if (
      assessment.outcome === "ready" &&
      assessment.acceptedStepCount <= accepted
    )
      return refused(
        proposal.id,
        "blocked",
        "Provider did not accept the assessed write; no further steps were attempted.",
      );
  }
  if (assessment.outcome !== "ready") {
    if (assessment.outcome === "stale" && assessment.acceptedStepCount === 0)
      await input.proposalStore.markStale(proposal.id, "live-version-changed");
    return assessmentReport(proposal.id, assessment);
  }
  if (
    recorded !== undefined &&
    (recorded.eventIds ?? [recorded.eventId]).join("\0") !==
      assessment.results.map(({ eventId }) => eventId).join("\0") &&
    proposal.operation !== "cancel"
  )
    return refused(
      proposal.id,
      "blocked",
      "Completed receipt event identities do not match the approved plan.",
    );
  const verifiedEvents: CalendarEvent[] = [];
  for (const ref of assessment.results)
    verifiedEvents.push(await input.writer.readEvent(ref));
  const eventIds = assessment.results.map(({ eventId }) => eventId);
  const eventId =
    eventIds[0] ??
    (proposal.operation === "cancel"
      ? proposal.sourceItem.eventId
      : proposal.id);
  const appended =
    recorded === undefined
      ? await input.journal.appendOnce({
          schemaVersion: 1,
          proposalId: proposal.id,
          eventId,
          ...(eventIds.length > 1 ||
          proposal.operation === "bulk-create" ||
          proposal.operation === "routine-migration"
            ? { eventIds }
            : {}),
          idempotencyKey: proposal.idempotencyKey,
          calendarId: proposal.target.calendarId,
        })
      : false;
  const finalRefresh = await input.refresh();
  if (finalRefresh.calendars.some(({ freshness }) => freshness === "stale"))
    return refused(
      proposal.id,
      "blocked",
      "Approved effects were read back but the final Refresh is incomplete.",
    );
  const mirror = await input.mirrorStore.read(proposal.target.calendarRole);
  if (
    mirror === undefined ||
    verifiedEvents.some(
      (event) =>
        !mirror.items.some(
          (item) =>
            item.event.id === event.id &&
            calendarContentMatches(item.event, event),
        ),
    )
  )
    return refused(
      proposal.id,
      "blocked",
      "Approved provider effects are missing from the refreshed Owned mirror.",
    );
  if (proposal.operation === "cancel") {
    if (proposal.recurrenceScope === "this-and-future") {
      if (
        !mirror.tombstones.some(
          ({ event }) => event.id === proposal.preview.event.id,
        )
      )
        await input.mirrorStore.write({
          ...mirror,
          tombstones: [
            ...mirror.tombstones,
            {
              access: "owned",
              deletedAt:
                mirror.lastSuccessfulRefresh ?? new Date().toISOString(),
              event: proposal.preview.event,
            },
          ],
        });
    } else if (
      !mirror.tombstones.some(
        ({ event }) => event.id === proposal.sourceItem.eventId,
      )
    )
      return refused(
        proposal.id,
        "blocked",
        "Cancellation is not retained in the refreshed Calendar tombstones.",
      );
  }
  await input.proposalStore.markPromoted(proposal.id);
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome: appended ? "promoted" : "retry",
    proposalId: proposal.id,
    ...(proposal.operation === "bulk-create" ||
    proposal.operation === "routine-migration"
      ? { verifiedEvents }
      : verifiedEvents[0] === undefined
        ? {}
        : { verifiedEvent: verifiedEvents[0] }),
  };
}

async function finalizeLegacyReceipt(
  input: PromotionInput,
  proposal: CalendarStoredProposal,
  eventIds: string[],
): Promise<CalendarPromotionReport> {
  const events: CalendarEvent[] = [];
  for (const eventId of eventIds) {
    let event: CalendarEvent;
    try {
      event = await input.writer.readEvent({
        calendarId: proposal.target.calendarId,
        eventId,
      });
    } catch {
      return refused(
        proposal.id,
        "blocked",
        "Legacy receipt could not be verified read-only; reconcile the existing effects.",
      );
    }
    if (proposal.operation === "create" || proposal.operation === "restore") {
      const expected =
        proposal.operation === "restore"
          ? restorableEvent(proposal.intendedEvent, proposal.idempotencyKey)
          : { ...proposal.intendedEvent, id: eventId };
      if (
        eventId !== calendarEventIdFor(proposal.idempotencyKey) ||
        !calendarContentMatches(event, expected)
      )
        return refused(
          proposal.id,
          "blocked",
          "Legacy receipt content differs from the approved effect.",
        );
    } else if (
      proposal.operation === "update" ||
      proposal.operation === "move"
    ) {
      if (!eventContainsPatch(event, proposal.patch))
        return refused(
          proposal.id,
          "blocked",
          "Legacy receipt patch differs from the approved effect.",
        );
    } else
      return refused(
        proposal.id,
        "blocked",
        "Legacy receipt requires read-only reconciliation; re-preview before further writes.",
      );
    events.push(event);
  }
  const refreshed = await input.refresh();
  if (refreshed.calendars.some(({ freshness }) => freshness === "stale"))
    return refused(
      proposal.id,
      "blocked",
      "Legacy receipt Refresh is incomplete.",
    );
  const mirror = await input.mirrorStore.read(proposal.target.calendarRole);
  if (
    events.some(
      (event) =>
        !mirror?.items.some(
          (item) =>
            item.event.id === event.id &&
            calendarContentMatches(item.event, event),
        ),
    )
  )
    return refused(
      proposal.id,
      "blocked",
      "Legacy receipt is absent from the refreshed mirror.",
    );
  await input.proposalStore.markPromoted(proposal.id);
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome: "retry",
    proposalId: proposal.id,
    ...(events[0] !== undefined && events.length === 1
      ? { verifiedEvent: events[0] }
      : { verifiedEvents: events }),
  };
}

async function stale(
  input: PromotionInput,
  proposalId: string,
  reason: string,
): Promise<CalendarPromotionReport> {
  await input.proposalStore.markStale(proposalId, "live-version-changed");
  return refused(proposalId, "stale", reason);
}
function assessmentReport(
  proposalId: string,
  assessment: Exclude<CalendarAssessment, { outcome: "ready" }>,
): CalendarPromotionReport {
  return {
    ...refused(proposalId, assessment.outcome, assessment.reason),
    acceptedStepCount: assessment.acceptedStepCount,
    remainingStepCount: assessment.remainingStepCount,
  };
}
function refused(
  proposalId: string,
  outcome: "blocked" | "stale",
  reason: string,
): CalendarPromotionReport {
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome,
    proposalId,
    reason,
  };
}
