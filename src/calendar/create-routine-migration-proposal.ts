import { calendarStateDigest } from "./calendar-state-digest.js";
import { isRecurringMaster } from "./calendar-event-helpers.js";
import type { ParsedCalendarRoutineMigrationProposalInput } from "./calendar-proposal-input.js";
import {
  currentCalendarMirror,
  readCurrentCalendarMirrors,
} from "./read-current-calendar-mirrors.js";
import type {
  CalendarEvent,
  CalendarProposalStore,
  CalendarProposeReport,
  CalendarProviderIdentity,
  CalendarRoutineMigrationCompletion,
  CalendarRoutineMigrationDecision,
  CalendarRoutineMigrationMove,
  CalendarRoutineMigrationProposalCandidate,
  OwnedCalendarMirror,
  OwnedCalendarMirrorStore,
  OwnedCalendarWorkspace,
} from "./types.js";

export async function createRoutineMigrationProposal(input: {
  value: ParsedCalendarRoutineMigrationProposalInput;
  workspace: OwnedCalendarWorkspace;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
}): Promise<CalendarProposeReport> {
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    input.workspace,
  );
  const academic = currentCalendarMirror(mirrors, "Academic");
  const routine = currentCalendarMirror(mirrors, "Routine");
  const reviewedIds = new Set(
    input.value.reviewedSeries.map(({ providerIdentity }) =>
      providerIdentityKey(providerIdentity),
    ),
  );
  const moves: CalendarRoutineMigrationMove[] = [];
  const completed: CalendarRoutineMigrationCompletion[] = [];
  const decisions: CalendarRoutineMigrationDecision[] = [];

  for (const reviewed of input.value.reviewedSeries) {
    const matches = findEventMatches(
      mirrors,
      reviewed.providerIdentity.eventId,
    );
    if (matches.length === 0) {
      decisions.push({
        providerIdentity: reviewed.providerIdentity,
        reason:
          academic.calendarId === reviewed.providerIdentity.calendarId &&
          academic.tombstones.some(
            ({ event }) => event.id === reviewed.providerIdentity.eventId,
          )
            ? "provider-identity-deleted"
            : "provider-identity-not-found",
        ...(reviewed.label === undefined
          ? {}
          : { reviewedLabel: reviewed.label }),
      });
      continue;
    }
    if (matches.length > 1) {
      decisions.push({
        providerIdentity: reviewed.providerIdentity,
        reason: "provider-identity-on-multiple-calendars",
        ...(matches[0]?.item.event.summary === undefined
          ? {}
          : { summary: matches[0].item.event.summary }),
        ...(reviewed.label === undefined
          ? {}
          : { reviewedLabel: reviewed.label }),
      });
      continue;
    }
    const match = matches[0];
    if (match === undefined) continue;
    if (match.mirror.role === "Routine") {
      if (reviewed.providerIdentity.calendarId !== academic.calendarId) {
        decisions.push({
          providerIdentity: identity(match.mirror, match.item.event.id),
          reason: "provider-identity-on-unexpected-calendar",
          ...(match.item.event.summary === undefined
            ? {}
            : { summary: match.item.event.summary }),
          ...(reviewed.label === undefined
            ? {}
            : { reviewedLabel: reviewed.label }),
          actualCalendarRole: match.mirror.role,
        });
        continue;
      }
      if (!isRecurringMaster(match.item.event)) {
        decisions.push({
          providerIdentity: identity(match.mirror, match.item.event.id),
          reason: "not-recurring-series",
          ...(match.item.event.summary === undefined
            ? {}
            : { summary: match.item.event.summary }),
          ...(reviewed.label === undefined
            ? {}
            : { reviewedLabel: reviewed.label }),
        });
      } else if (
        academic.items.some(
          ({ event }) => event.recurringEventId === match.item.event.id,
        )
      ) {
        decisions.push({
          providerIdentity: identity(match.mirror, match.item.event.id),
          reason: "partial-recurring-series",
          ...(match.item.event.summary === undefined
            ? {}
            : { summary: match.item.event.summary }),
          ...(reviewed.label === undefined
            ? {}
            : { reviewedLabel: reviewed.label }),
        });
      } else {
        completed.push({
          providerIdentity: identity(match.mirror, match.item.event.id),
          ...(match.item.event.summary === undefined
            ? {}
            : { summary: match.item.event.summary }),
        });
      }
      continue;
    }
    if (
      match.mirror.role !== "Academic" ||
      match.mirror.calendarId !== reviewed.providerIdentity.calendarId
    ) {
      decisions.push({
        providerIdentity: identity(match.mirror, match.item.event.id),
        reason: "provider-identity-on-unexpected-calendar",
        ...(match.item.event.summary === undefined
          ? {}
          : { summary: match.item.event.summary }),
        ...(reviewed.label === undefined
          ? {}
          : { reviewedLabel: reviewed.label }),
        actualCalendarRole: match.mirror.role,
      });
      continue;
    }
    const decision = decisionForAcademicEvent(
      match.mirror,
      match.item.event,
      reviewed.label,
    );
    if (decision !== undefined) {
      decisions.push(decision);
      continue;
    }
    moves.push(createMove(academic, routine, match.item.event));
  }

  for (const item of [...academic.items].sort((left, right) =>
    left.event.id.localeCompare(right.event.id),
  )) {
    if (
      !reviewedIds.has(
        providerIdentityKey(identity(academic, item.event.id)),
      ) &&
      isRecurringMaster(item.event)
    ) {
      decisions.push({
        providerIdentity: identity(academic, item.event.id),
        reason: "unreviewed-recurring-series",
        ...(item.event.summary === undefined
          ? {}
          : { summary: item.event.summary }),
      });
    }
  }

  const proposalDigest = calendarStateDigest({
    operation: "routine-migration",
    source: input.value.source,
    moves,
    completed,
    decisions,
  });
  const proposal: CalendarRoutineMigrationProposalCandidate & {
    status: "ready";
  } = {
    id: `proposal-${proposalDigest.slice(0, 24)}`,
    status: "ready",
    operation: "routine-migration",
    source: input.value.source,
    itemKind: "routine-event",
    target: { calendarRole: "Routine", calendarId: routine.calendarId },
    moves,
    completed,
    decisions,
    idempotencyKey: `routine-migration-${proposalDigest}`,
    liveVersions: mirrors.map((mirror) => ({
      kind: "owned-mirror" as const,
      calendarRole: mirror.role,
      calendarId: mirror.calendarId,
      syncToken: mirror.syncToken as string,
      lastSuccessfulRefresh: mirror.lastSuccessfulRefresh as string,
    })),
    relevantAvailabilityVersion: {
      digest: calendarStateDigest([]),
      interval: null,
      checkedCalendarCount: 0,
    },
    conflictSummary: { blockers: 0, warnings: 0 },
  };
  await input.proposalStore.writeCurrent(proposal);
  return {
    schemaVersion: 1,
    command: "calendar propose",
    outcome: "ready",
    proposal,
    conflicts: [],
    warnings: [],
    workspace: "written",
  };
}

function createMove(
  sourceMirror: OwnedCalendarMirror,
  targetMirror: OwnedCalendarMirror,
  master: CalendarEvent,
): CalendarRoutineMigrationMove {
  const recurrenceExceptions = sourceMirror.items
    .map(({ event }) => event)
    .filter(({ recurringEventId }) => recurringEventId === master.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const patch =
    master.transparency === "transparent"
      ? {}
      : { transparency: "transparent" as const };
  const moveIntent = {
    operation: "routine-migration",
    sourceCalendarId: sourceMirror.calendarId,
    targetCalendarId: targetMirror.calendarId,
    eventId: master.id,
    versionDigest: calendarStateDigest(master),
    patch,
    seriesEventIds: [master.id, ...recurrenceExceptions.map(({ id }) => id)],
  };
  return {
    sourceItem: {
      calendarRole: "Academic",
      calendarId: sourceMirror.calendarId,
      eventId: master.id,
      versionDigest: calendarStateDigest(master),
    },
    target: {
      calendarRole: "Routine",
      calendarId: targetMirror.calendarId,
    },
    patch,
    recurrenceScope: "entire-series",
    recurringMaster: master,
    recurrenceExceptions,
    seriesEventIds: moveIntent.seriesEventIds,
  };
}

function decisionForAcademicEvent(
  mirror: OwnedCalendarMirror,
  event: CalendarEvent,
  reviewedLabel: string | undefined,
): CalendarRoutineMigrationDecision | undefined {
  const providerIdentity = identity(mirror, event.id);
  const common = {
    providerIdentity,
    ...(event.summary === undefined ? {} : { summary: event.summary }),
    ...(reviewedLabel === undefined ? {} : { reviewedLabel }),
  };
  if (!isRecurringMaster(event)) {
    return {
      ...common,
      reason:
        event.recurringEventId === undefined
          ? "not-recurring-series"
          : "recurring-exception",
    };
  }
  if (
    mirror.items.find(({ event: candidate }) => candidate.id === event.id)
      ?.access !== "owned"
  ) {
    return { ...common, reason: "invited-series" };
  }
  if (event.eventType !== undefined && event.eventType !== "default") {
    return { ...common, reason: "unsupported-event-type" };
  }
  return undefined;
}

function findEventMatches(
  mirrors: OwnedCalendarMirror[],
  eventId: string,
): Array<{
  mirror: OwnedCalendarMirror;
  item: OwnedCalendarMirror["items"][number];
}> {
  return mirrors.flatMap((mirror) =>
    mirror.items
      .filter(({ event }) => event.id === eventId)
      .map((item) => ({ mirror, item })),
  );
}

function providerIdentityKey(
  providerIdentity: CalendarProviderIdentity,
): string {
  return `${providerIdentity.calendarRole}\u0000${providerIdentity.calendarId}\u0000${providerIdentity.eventId}`;
}

function identity(
  mirror: OwnedCalendarMirror,
  eventId: string,
): CalendarProviderIdentity {
  return {
    calendarRole: mirror.role,
    calendarId: mirror.calendarId,
    eventId,
  };
}
