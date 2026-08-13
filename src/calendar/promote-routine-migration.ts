import { OperationalError } from "../operational-error.js";
import {
  eventContainsPatch,
  isRecurringMaster,
} from "./calendar-event-helpers.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import {
  currentCalendarMirror,
  readCurrentCalendarMirrors,
} from "./read-current-calendar-mirrors.js";
import type {
  CalendarEvent,
  CalendarProposalStore,
  CalendarPromotionJournal,
  CalendarPromotionReport,
  CalendarPromotionWriter,
  CalendarRefreshReport,
  CalendarRoutineMigrationMove,
  CalendarRoutineMigrationProposalCandidate,
  OwnedCalendarMirror,
  OwnedCalendarMirrorStore,
  OwnedCalendarWorkspaceReader,
} from "./types.js";

interface RoutineMigrationPromotionInput {
  proposalStore: CalendarProposalStore;
  writer: CalendarPromotionWriter;
  journal: CalendarPromotionJournal;
  refresh: () => Promise<CalendarRefreshReport>;
  workspaceReader: OwnedCalendarWorkspaceReader;
  mirrorStore: OwnedCalendarMirrorStore;
}

export async function promoteRoutineMigration(
  input: RoutineMigrationPromotionInput,
  proposal: CalendarRoutineMigrationProposalCandidate & { status: "ready" },
): Promise<CalendarPromotionReport> {
  const recorded = await input.journal.find(proposal.id);
  if (recorded !== undefined) {
    return await finalizeRoutineMigration(input, proposal, false);
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
  const validation = await validateRoutineMigrationProposal(proposal, input);
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
  await applyRoutineMigrationMoves(
    input.writer,
    proposal,
    input.mirrorStore,
    input.workspaceReader,
  );
  if (!(await rereadRoutineMigration(input.writer, proposal))) {
    return blockedReport(proposal.id);
  }
  const appended = await input.journal.appendOnce({
    schemaVersion: 1,
    proposalId: proposal.id,
    eventId: proposal.moves[0]?.sourceItem.eventId ?? proposal.id,
    eventIds: proposal.moves.map(({ sourceItem }) => sourceItem.eventId),
    idempotencyKey: proposal.idempotencyKey,
    calendarId: proposal.target.calendarId,
  });
  return await finalizeRoutineMigration(input, proposal, appended);
}

async function validateRoutineMigrationProposal(
  proposal: CalendarRoutineMigrationProposalCandidate,
  input: Pick<
    RoutineMigrationPromotionInput,
    "workspaceReader" | "mirrorStore"
  >,
): Promise<"valid" | "stale" | "blocked"> {
  const workspace = await input.workspaceReader.read();
  if (proposal.target.calendarId !== workspace.ownedCalendarIds.Routine) {
    return "blocked";
  }
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    workspace,
  );
  const academic = currentCalendarMirror(mirrors, "Academic");
  const routine = currentCalendarMirror(mirrors, "Routine");
  for (const move of proposal.moves) {
    if (
      move.sourceItem.calendarRole !== "Academic" ||
      move.sourceItem.calendarId !== academic.calendarId ||
      move.target.calendarId !== routine.calendarId
    ) {
      return "blocked";
    }
    const sourceMaster = academic.items.find(
      ({ event }) => event.id === move.sourceItem.eventId,
    )?.event;
    const targetMaster = routine.items.find(
      ({ event }) => event.id === move.sourceItem.eventId,
    )?.event;
    if (sourceMaster === undefined) {
      if (
        targetMaster === undefined ||
        !migrationTargetMatchesSource(targetMaster, move)
      ) {
        return "stale";
      }
      if (
        academic.items.some(({ event }) =>
          move.seriesEventIds.includes(event.id),
        ) ||
        !migrationTargetContainsExpectedSeries(routine, move)
      ) {
        return "stale";
      }
      continue;
    }
    if (targetMaster !== undefined) return "blocked";
    if (calendarStateDigest(sourceMaster) !== move.sourceItem.versionDigest) {
      return "stale";
    }
    for (const exception of move.recurrenceExceptions) {
      const current = academic.items.find(
        ({ event }) => event.id === exception.id,
      )?.event;
      if (
        current === undefined ||
        calendarStateDigest(current) !== calendarStateDigest(exception)
      ) {
        return "stale";
      }
    }
    const currentExceptionIds = academic.items
      .map(({ event }) => event)
      .filter(({ recurringEventId }) => recurringEventId === sourceMaster.id)
      .map(({ id }) => id)
      .sort();
    const expectedExceptionIds = move.recurrenceExceptions
      .map(({ id }) => id)
      .sort();
    if (
      calendarStateDigest(currentExceptionIds) !==
      calendarStateDigest(expectedExceptionIds)
    ) {
      return "stale";
    }
  }
  return "valid";
}

async function applyRoutineMigrationMoves(
  writer: CalendarPromotionWriter,
  proposal: CalendarRoutineMigrationProposalCandidate,
  mirrorStore: OwnedCalendarMirrorStore,
  workspaceReader: OwnedCalendarWorkspaceReader,
): Promise<void> {
  const workspace = await workspaceReader.read();
  const mirrors = await readCurrentCalendarMirrors(mirrorStore, workspace);
  const academic = currentCalendarMirror(mirrors, "Academic");
  const routine = currentCalendarMirror(mirrors, "Routine");
  for (const move of proposal.moves) {
    const sourceMaster = academic.items.find(
      ({ event }) => event.id === move.sourceItem.eventId,
    )?.event;
    const targetMaster = routine.items.find(
      ({ event }) => event.id === move.sourceItem.eventId,
    )?.event;
    if (sourceMaster === undefined) {
      if (
        targetMaster !== undefined &&
        Object.keys(move.patch).length > 0 &&
        !eventContainsPatch(targetMaster, move.patch)
      ) {
        await writer.patchEvent({
          calendarId: move.target.calendarId,
          eventId: move.sourceItem.eventId,
          patch: move.patch,
        });
      }
      continue;
    }
    await writer.moveEvent({
      sourceCalendarId: move.sourceItem.calendarId,
      targetCalendarId: move.target.calendarId,
      eventId: move.sourceItem.eventId,
    });
    if (Object.keys(move.patch).length > 0) {
      await writer.patchEvent({
        calendarId: move.target.calendarId,
        eventId: move.sourceItem.eventId,
        patch: move.patch,
      });
    }
  }
}

async function finalizeRoutineMigration(
  input: RoutineMigrationPromotionInput,
  proposal: CalendarRoutineMigrationProposalCandidate,
  appended: boolean,
): Promise<CalendarPromotionReport> {
  const refreshed = await input.refresh();
  if (
    refreshed.calendars.some(({ freshness }) => freshness === "stale") ||
    !(await routineMigrationVerified(input, proposal))
  ) {
    return blockedReport(proposal.id);
  }
  await input.proposalStore.markPromoted(proposal.id);
  const routine = await input.mirrorStore.read("Routine");
  const verifiedEvents = proposal.moves.flatMap(({ sourceItem }) => {
    const event = routine?.items.find(
      ({ event: candidate }) => candidate.id === sourceItem.eventId,
    )?.event;
    return event === undefined ? [] : [event];
  });
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome: appended ? "promoted" : "retry",
    proposalId: proposal.id,
    verifiedEvents,
  };
}

async function routineMigrationVerified(
  input: Pick<
    RoutineMigrationPromotionInput,
    "mirrorStore" | "workspaceReader"
  >,
  proposal: CalendarRoutineMigrationProposalCandidate,
): Promise<boolean> {
  const workspace = await input.workspaceReader.read();
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    workspace,
  );
  const academic = currentCalendarMirror(mirrors, "Academic");
  const routine = currentCalendarMirror(mirrors, "Routine");
  return proposal.moves.every((move) => {
    const targetItems = move.seriesEventIds.map((eventId) =>
      routine.items.find(({ event }) => event.id === eventId),
    );
    if (targetItems.some((item) => item === undefined)) return false;
    if (
      academic.items.some(({ event }) => move.seriesEventIds.includes(event.id))
    ) {
      return false;
    }
    const targetEvents = targetItems.flatMap((item) =>
      item === undefined ? [] : [item.event],
    );
    const targetMaster = targetEvents.find(
      ({ id }) => id === move.sourceItem.eventId,
    );
    if (
      targetMaster === undefined ||
      !isVerifiedMigrationMaster(targetMaster, move)
    ) {
      return false;
    }
    return migrationExceptionsVerified(
      routine.items.map(({ event }) => event),
      move,
    );
  });
}

function isVerifiedMigrationMaster(
  event: CalendarEvent,
  move: CalendarRoutineMigrationMove,
): boolean {
  return (
    isRecurringMaster(event) &&
    eventContainsPatch(event, move.patch) &&
    calendarStateDigest(event.recurrence) ===
      calendarStateDigest(move.recurringMaster.recurrence) &&
    migrationEventDigest(event) ===
      migrationEventDigest({ ...move.recurringMaster, ...move.patch })
  );
}

async function rereadRoutineMigration(
  writer: CalendarPromotionWriter,
  proposal: CalendarRoutineMigrationProposalCandidate,
): Promise<boolean> {
  for (const move of proposal.moves) {
    const rereadEvents: CalendarEvent[] = [];
    for (const eventId of move.seriesEventIds) {
      try {
        rereadEvents.push(
          await writer.readEvent({
            calendarId: move.target.calendarId,
            eventId,
          }),
        );
      } catch {
        return false;
      }
    }
    const master = rereadEvents.find(
      ({ id }) => id === move.sourceItem.eventId,
    );
    if (master === undefined || !isVerifiedMigrationMaster(master, move)) {
      return false;
    }
    if (!migrationExceptionsVerified(rereadEvents, move)) return false;
  }
  return true;
}

function migrationTargetContainsExpectedSeries(
  routine: OwnedCalendarMirror,
  move: CalendarRoutineMigrationMove,
): boolean {
  const targetMaster = routine.items.find(
    ({ event }) => event.id === move.sourceItem.eventId,
  )?.event;
  if (
    targetMaster === undefined ||
    !migrationTargetMatchesSource(targetMaster, move)
  ) {
    return false;
  }
  return migrationExceptionsVerified(
    routine.items.map(({ event }) => event),
    move,
  );
}

function migrationExceptionsVerified(
  events: CalendarEvent[],
  move: CalendarRoutineMigrationMove,
): boolean {
  const actualExceptionIds = events
    .filter(
      ({ recurringEventId }) => recurringEventId === move.sourceItem.eventId,
    )
    .map(({ id }) => id)
    .sort();
  const expectedExceptionIds = move.recurrenceExceptions
    .map(({ id }) => id)
    .sort();
  if (
    calendarStateDigest(actualExceptionIds) !==
    calendarStateDigest(expectedExceptionIds)
  ) {
    return false;
  }
  return move.recurrenceExceptions.every((expected) => {
    const current = events.find(({ id }) => id === expected.id);
    return (
      current !== undefined &&
      current.recurringEventId === move.sourceItem.eventId &&
      migrationEventDigest(current) === migrationEventDigest(expected)
    );
  });
}

function migrationTargetMatchesSource(
  event: CalendarEvent,
  move: CalendarRoutineMigrationMove,
): boolean {
  if (!isRecurringMaster(event)) return false;
  const expected = { ...move.recurringMaster };
  const actual = { ...event };
  for (const key of Object.keys(move.patch)) {
    delete expected[key];
    delete actual[key];
  }
  return (
    calendarStateDigest(actual.recurrence) ===
      calendarStateDigest(expected.recurrence) &&
    migrationEventDigest(actual) === migrationEventDigest(expected)
  );
}

function migrationEventDigest(event: CalendarEvent): string {
  const value = { ...event };
  for (const key of [
    "organizer",
    "etag",
    "created",
    "updated",
    "htmlLink",
    "sequence",
  ]) {
    delete value[key];
  }
  return calendarStateDigest(value);
}

function blockedReport(proposalId: string): CalendarPromotionReport {
  return {
    schemaVersion: 1,
    command: "calendar promote",
    outcome: "blocked",
    proposalId,
  };
}
