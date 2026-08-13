import { createHash } from "node:crypto";

import { OperationalError } from "../operational-error.js";
import {
  collectCalendarAvailability,
  findCalendarOverlaps,
} from "./calendar-conflicts.js";
import { calendarStateDigest } from "./create-calendar-proposal.js";
import type {
  CalendarProposal,
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

export async function promoteCalendarProposal(input: {
  proposalId: string;
  proposalStore: CalendarProposalStore;
  writer: CalendarPromotionWriter;
  journal: CalendarPromotionJournal;
  refresh: () => Promise<CalendarRefreshReport>;
  reader: CalendarProposalReader;
  workspaceReader: OwnedCalendarWorkspaceReader;
  mirrorStore: OwnedCalendarMirrorStore;
}): Promise<CalendarPromotionReport> {
  const proposal = await input.proposalStore.read(input.proposalId);
  if (proposal === undefined) {
    throw new OperationalError(
      "invalid-target",
      "Calendar Promote requires an existing ready Proposal ID.",
    );
  }
  const eventId = eventIdFor(proposal.idempotencyKey);
  const recorded = await input.journal.find(proposal.id);
  if (recorded !== undefined) {
    const verifiedEvent = await input.writer.readEvent({
      calendarId: proposal.target.calendarId,
      eventId: recorded.eventId,
    });
    const refreshed = await input.refresh();
    if (refreshed.calendars.some(({ freshness }) => freshness === "stale")) {
      return blockedReport(proposal.id);
    }
    if (!(await mirrorContainsVerifiedEvent(input, proposal, verifiedEvent))) {
      return blockedReport(proposal.id);
    }
    await input.proposalStore.markPromoted(proposal.id);
    return report("retry", proposal.id, verifiedEvent);
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
  try {
    await input.writer.createEvent({
      calendarId: proposal.target.calendarId,
      eventId,
      event: proposal.intendedEvent,
      idempotencyKey: proposal.idempotencyKey,
    });
  } catch (error) {
    try {
      await input.writer.readEvent({
        calendarId: proposal.target.calendarId,
        eventId,
      });
    } catch {
      throw error;
    }
  }
  const verifiedEvent = await input.writer.readEvent({
    calendarId: proposal.target.calendarId,
    eventId,
  });
  const appended = await input.journal.appendOnce({
    schemaVersion: 1,
    proposalId: proposal.id,
    eventId,
    idempotencyKey: proposal.idempotencyKey,
  });
  const postRefresh = await input.refresh();
  if (postRefresh.calendars.some(({ freshness }) => freshness === "stale")) {
    return blockedReport(proposal.id);
  }
  if (!(await mirrorContainsVerifiedEvent(input, proposal, verifiedEvent))) {
    return blockedReport(proposal.id);
  }
  await input.proposalStore.markPromoted(proposal.id);
  return report(appended ? "promoted" : "retry", proposal.id, verifiedEvent);
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
  const target = calendars.find(({ id }) => id === proposal.target.calendarId);
  if (target?.etag !== proposal.targetCalendarVersion.etag) return "stale";
  const mirrors = [];
  for (const role of OWNED_CALENDAR_ROLES) {
    const mirror = await input.mirrorStore.read(role);
    if (mirror === undefined || mirror.freshness === "stale") return "blocked";
    mirrors.push(mirror);
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
  const availabilityDigest = calendarStateDigest(
    availability.items.map(({ calendarId, event }) => ({ calendarId, event })),
  );
  if (
    availabilityDigest !== proposal.relevantAvailabilityVersion.digest ||
    availability.checkedCalendarCount !==
      proposal.relevantAvailabilityVersion.checkedCalendarCount
  ) {
    const blockers = findCalendarOverlaps({
      availability: availability.items,
      interval,
      proposedKind: proposal.itemKind,
    }).filter(({ severity }) => severity === "block");
    return blockers.length > 0 ? "blocked" : "stale";
  }
  return "valid";
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
