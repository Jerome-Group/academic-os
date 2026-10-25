import { restorableEvent } from "./calendar-event-helpers.js";
import {
  calendarGeometry,
  originalCalendarStart,
  CALENDAR_EXPANSION_VERSION,
} from "./calendar-occurrences.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import {
  compilePlan,
  sameOriginal,
  atOrAfter,
  refKey,
  unsupported,
  type EventRef,
  type Original,
  type SeriesInventory,
  type Occupant,
  type State,
  type Step,
  type Plan,
} from "./calendar-mutation-plan.js";
import {
  observeOriginals,
  observeInventories,
  observeProgress,
  calendarContentMatches,
} from "./calendar-mutation-state.js";
import type {
  CalendarEvent,
  CalendarInterval,
  CalendarListEntry,
  CalendarOverlap,
  CalendarProposalCandidate,
  CalendarProposalReader,
  CalendarPromotionWriter,
  OwnedCalendarMirror,
  OwnedCalendarWorkspace,
} from "./types.js";
import { OWNED_CALENDAR_ROLES } from "./types.js";
export { calendarContentMatches } from "./calendar-mutation-state.js";
export { calendarTimetableMapVersion } from "./calendar-mutation-plan.js";

export interface CalendarAssessmentReview {
  schemaVersion: 2;
  intentDigest: string;
  planDigest: string;
  binding: string;
  originals: Original[];
  inventories: SeriesInventory[];
  coverage: {
    kind: "complete-finite" | "not-required";
    reason?: string;
    occurrences: Occupant[];
    warningCoverage: Plan["warningCoverage"];
    restorationScope?: Plan["restorationScope"];
  };
  engine: { expansion: string; node: string; icu: string; tz: string };
}

export type CalendarAssessment =
  | {
      outcome: "ready";
      review: CalendarAssessmentReview;
      conflicts: CalendarOverlap[];
      warnings: CalendarOverlap[];
      checkedCalendarCount: number;
      acceptedStepCount: number;
      remainingStepCount: number;
      results: EventRef[];
      executeNext: (writer: CalendarPromotionWriter) => Promise<void>;
    }
  | {
      outcome: "blocked" | "stale";
      reason: string;
      conflicts: CalendarOverlap[];
      warnings: CalendarOverlap[];
      acceptedStepCount: number;
      remainingStepCount: number;
    };

export async function assessCalendarProposal(input: {
  proposal: CalendarProposalCandidate;
  workspace: OwnedCalendarWorkspace;
  reader: CalendarProposalReader;
  mirrors: OwnedCalendarMirror[];
  promotion?: boolean;
  completed?: boolean;
}): Promise<CalendarAssessment> {
  const { proposal, workspace, reader } = input;
  const saved = proposal.review;
  if (proposal.operation === "restore") {
    const retained = input.mirrors
      .find(
        ({ role, calendarId }) =>
          role === proposal.restoredFrom.calendarRole &&
          calendarId === proposal.target.calendarId,
      )
      ?.tombstones.find(
        ({ event, deletedAt }) =>
          event.id === proposal.restoredFrom.eventId &&
          deletedAt === proposal.restoredFrom.deletedAt,
      );
    if (
      retained === undefined ||
      retained.access === "invited-read-only" ||
      !calendarContentMatches(
        restorableEvent(retained.event, proposal.idempotencyKey),
        restorableEvent(proposal.intendedEvent, proposal.idempotencyKey),
      )
    )
      return refusal(
        "stale",
        "Retained Owned restoration content changed; re-preview required.",
      );
  }
  if (input.promotion && saved?.schemaVersion !== 2)
    return refusal(
      "stale",
      "Legacy Calendar Proposal requires re-preview; saved intervals cannot authorize publication.",
    );
  const calendars = await reader.listCalendars();
  validateCalendarMembership(workspace, calendars, proposal);
  const originals =
    saved?.originals ??
    (await observeOriginals(proposal, reader, input.mirrors));
  const inventories =
    saved?.inventories ??
    (await observeInventories(proposal, reader, originals));
  const plan = compilePlan(
    proposal,
    workspace,
    calendars,
    originals,
    inventories,
  );
  const intentDigest = calendarStateDigest(proposalIntent(proposal));
  const planDigest = calendarStateDigest(plan);
  const progress = await observeProgress(
    plan,
    inventories,
    reader,
    input.mirrors,
  );
  if (progress === undefined)
    return refusal(
      "stale",
      "Live Calendar state is neither the reviewed original nor an exact accepted prefix; re-preview or reconcile the partial publication.",
      plan.steps.length,
    );
  const engine = {
    expansion: CALENDAR_EXPANSION_VERSION,
    node: process.versions.node,
    icu: process.versions.icu ?? "unknown",
    tz: process.versions.tz ?? "unknown",
  };
  if (input.completed && progress.accepted !== plan.steps.length)
    return refusal(
      "blocked",
      "Completed receipt no longer matches the complete approved publication.",
      plan.steps.length,
      progress.accepted,
    );
  const overlaps = peerOverlaps(plan.occupants);
  const availability = await assessExternal(
    plan,
    workspace,
    calendars,
    reader,
    progress.acceptedStates,
  );
  overlaps.push(...availability.overlaps);
  const conflicts = overlaps.filter(({ severity }) => severity === "block");
  const warnings = overlaps.filter(({ severity }) => severity === "warning");
  const review: CalendarAssessmentReview = {
    schemaVersion: 2,
    intentDigest,
    planDigest,
    originals,
    inventories,
    engine,
    coverage: {
      kind: plan.coverage,
      ...(plan.reason === undefined ? {} : { reason: plan.reason }),
      occurrences: plan.occupants,
      warningCoverage: plan.warningCoverage,
      ...(plan.restorationScope === undefined
        ? {}
        : { restorationScope: plan.restorationScope }),
    },
    binding: calendarStateDigest({
      intentDigest,
      planDigest,
      engine,
      participants: participantBinding(workspace, calendars),
      availability: availability.binding,
      warnings,
    }),
  };
  if (!input.completed && conflicts.length > 0)
    return {
      ...refusal(
        "blocked",
        "Current intended occupancy conflicts with Calendar availability.",
        plan.steps.length,
        progress.accepted,
      ),
      conflicts,
      warnings,
    };
  if (
    input.promotion &&
    (saved?.intentDigest !== intentDigest ||
      saved.planDigest !== planDigest ||
      calendarStateDigest(saved.coverage) !==
        calendarStateDigest(review.coverage) ||
      calendarStateDigest(saved.engine) !== calendarStateDigest(engine) ||
      (!input.completed && saved.binding !== review.binding))
  )
    return {
      ...refusal(
        "stale",
        "Calendar intent, scope, source, conversion data, calendar membership or reviewed availability changed; re-preview required.",
        plan.steps.length,
        progress.accepted,
      ),
      warnings,
    };
  const next = plan.steps[progress.accepted];
  let used = false;
  return {
    outcome: "ready",
    review,
    conflicts,
    warnings,
    checkedCalendarCount:
      plan.occupants.length === 0
        ? 0
        : participants(workspace, calendars).length,
    acceptedStepCount: progress.accepted,
    remainingStepCount: plan.steps.length - progress.accepted,
    results: plan.results,
    executeNext: async (writer) => {
      if (used || next === undefined || input.completed)
        throw new Error(
          "Calendar assessment has no remaining write authority.",
        );
      used = true;
      await executeStep(next, writer, progress.resolvedIds);
    },
  };
}

async function assessExternal(
  plan: Plan,
  workspace: OwnedCalendarWorkspace,
  calendars: CalendarListEntry[],
  reader: CalendarProposalReader,
  states: State[],
): Promise<{ overlaps: CalendarOverlap[]; binding: unknown }> {
  if (plan.occupants.length === 0) return { overlaps: [], binding: [] };
  const interval = bounding(plan.occupants.map(({ interval: value }) => value));
  const overlaps: CalendarOverlap[] = [];
  const binding: unknown[] = [];
  for (const calendar of participants(workspace, calendars)) {
    const role = OWNED_CALENDAR_ROLES.find(
      (candidate) => workspace.ownedCalendarIds[candidate] === calendar.id,
    );
    const events = await reader.listEventOccurrences({
      calendarId: calendar.id,
      timeMin: new Date(
        Math.floor(Date.parse(interval.start) / 1000) * 1000,
      ).toISOString(),
      timeMax: new Date(
        Math.ceil(Date.parse(interval.end) / 1000) * 1000,
      ).toISOString(),
    });
    for (const event of events) {
      if (
        event.status === "cancelled" ||
        excluded(event, calendar.id, plan, states)
      )
        continue;
      if (event.recurrence !== undefined)
        unsupported(
          "provider returned an unexpanded master for an occurrence query",
        );
      const geometry = calendarGeometry(event, calendar.timeZone);
      const matching = plan.occupants.filter((occupant) =>
        intersects(occupant.interval, geometry),
      );
      if (matching.length === 0) continue;
      binding.push({
        calendarId: calendar.id,
        eventId: event.id,
        originalStart: event.originalStartTime,
        interval: geometry,
        transparency: event.transparency ?? "opaque",
        summary: event.summary ?? "(untitled)",
      });
      for (const occupant of matching)
        overlaps.push({
          severity:
            occupant.role === "Routine" ||
            role === "Routine" ||
            event.transparency === "transparent"
              ? "warning"
              : "block",
          source: role === undefined ? "Observed" : "Owned",
          ...(role === undefined ? {} : { calendarRole: role }),
          eventId: event.id,
          proposedKey: occupant.key,
          originalStart: occupant.originalStart,
          summary: event.summary ?? "(untitled)",
          start: geometry.start,
          end: geometry.end,
        });
    }
  }
  binding.sort((a, b) =>
    calendarStateDigest(a).localeCompare(calendarStateDigest(b)),
  );
  return { overlaps, binding };
}

function excluded(
  event: CalendarEvent,
  calendarId: string,
  plan: Plan,
  states: State[],
): boolean {
  if (
    plan.exclusions.some(
      (exclusion) =>
        calendarId === exclusion.calendarId &&
        (exclusion.scope === "event"
          ? event.id === exclusion.eventId
          : (event.id === exclusion.eventId ||
              event.recurringEventId === exclusion.eventId) &&
            (exclusion.scope !== "future" ||
              (event.originalStartTime !== undefined &&
                atOrAfter(event, exclusion.boundary ?? "")))),
    )
  )
    return true;
  return states.some(
    (state) =>
      plan.steps.some(
        (step) =>
          (step.kind === "create" && refKey(step.ref) === refKey(state.ref)) ||
          (step.kind === "move" &&
            state.ref.calendarId === step.targetCalendarId),
      ) &&
      state.event !== null &&
      state.ref.calendarId === calendarId &&
      ("eventId" in state.ref
        ? event.id === state.ref.eventId ||
          event.recurringEventId === state.ref.eventId
        : event.recurringEventId === state.ref.seriesId &&
          sameOriginal(
            originalCalendarStart(event),
            state.ref.originalStart,
          )) &&
      plan.steps.some((step) =>
        step.changes.some((change) => refKey(change.ref) === refKey(state.ref)),
      ),
  );
}

function peerOverlaps(occupants: Occupant[]): CalendarOverlap[] {
  const sorted = [...occupants].sort(
    (a, b) =>
      Date.parse(a.interval.start) - Date.parse(b.interval.start) ||
      a.key.localeCompare(b.key),
  );
  const overlaps: CalendarOverlap[] = [];
  for (let left = 0; left < sorted.length; left += 1) {
    const first = sorted[left];
    if (first === undefined) continue;
    for (let right = left + 1; right < sorted.length; right += 1) {
      const second = sorted[right];
      if (
        second === undefined ||
        Date.parse(second.interval.start) >= Date.parse(first.interval.end)
      )
        break;
      if (!intersects(first.interval, second.interval)) continue;
      if (overlaps.length >= 10_000)
        unsupported("peer overlap evidence budget 10000 exceeded");
      overlaps.push({
        severity:
          first.role === "Routine" || second.role === "Routine"
            ? "warning"
            : "block",
        source: "Proposed",
        eventId: second.key,
        proposedKey: first.key,
        peerKey: second.key,
        originalStart: first.originalStart,
        peerOriginalStart: second.originalStart,
        summary: `Proposed ${first.key} overlaps ${second.key}`,
        start: new Date(
          Math.max(
            Date.parse(first.interval.start),
            Date.parse(second.interval.start),
          ),
        ).toISOString(),
        end: new Date(
          Math.min(
            Date.parse(first.interval.end),
            Date.parse(second.interval.end),
          ),
        ).toISOString(),
      });
    }
  }
  return overlaps;
}

async function executeStep(
  step: Step,
  writer: CalendarPromotionWriter,
  resolved: Map<string, string>,
): Promise<void> {
  const eventId =
    "eventId" in step.ref ? step.ref.eventId : resolved.get(refKey(step.ref));
  if (eventId === undefined)
    throw new Error(
      "Assessed Calendar step has no resolved provider identity.",
    );
  if (step.kind === "create")
    await writer.createEvent({
      calendarId: step.ref.calendarId,
      eventId,
      event: step.event,
      idempotencyKey: step.idempotencyKey,
    });
  else if (step.kind === "patch")
    await writer.patchEvent({
      calendarId: step.ref.calendarId,
      eventId,
      patch: step.patch,
    });
  else if (step.kind === "delete")
    await writer.deleteEvent({ calendarId: step.ref.calendarId, eventId });
  else
    await writer.moveEvent({
      sourceCalendarId: step.ref.calendarId,
      targetCalendarId: step.targetCalendarId,
      eventId,
    });
}

function intersects(left: CalendarInterval, right: CalendarInterval): boolean {
  return (
    Date.parse(left.start) < Date.parse(right.end) &&
    Date.parse(left.end) > Date.parse(right.start)
  );
}
function bounding(intervals: CalendarInterval[]): CalendarInterval {
  return {
    start: new Date(
      Math.min(...intervals.map(({ start }) => Date.parse(start))),
    ).toISOString(),
    end: new Date(
      Math.max(...intervals.map(({ end }) => Date.parse(end))),
    ).toISOString(),
  };
}
function participants(
  workspace: OwnedCalendarWorkspace,
  calendars: CalendarListEntry[],
): CalendarListEntry[] {
  return calendars
    .filter(
      (calendar) =>
        Object.values(workspace.ownedCalendarIds).includes(calendar.id) ||
        (calendar.selected === true && calendar.hidden !== true),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}
function participantBinding(
  workspace: OwnedCalendarWorkspace,
  calendars: CalendarListEntry[],
): unknown {
  return participants(workspace, calendars).map((calendar) => ({
    ...calendar,
    role: OWNED_CALENDAR_ROLES.find(
      (role) => workspace.ownedCalendarIds[role] === calendar.id,
    ),
  }));
}
function validateCalendarMembership(
  workspace: OwnedCalendarWorkspace,
  calendars: CalendarListEntry[],
  proposal: CalendarProposalCandidate,
): void {
  if (
    new Set(calendars.map(({ id }) => id)).size !== calendars.length ||
    OWNED_CALENDAR_ROLES.some(
      (role) =>
        !calendars.some(({ id }) => id === workspace.ownedCalendarIds[role]),
    ) ||
    proposal.target.calendarId !==
      workspace.ownedCalendarIds[proposal.target.calendarRole]
  )
    unsupported("Owned calendar membership changed or is unavailable");
  for (const role of OWNED_CALENDAR_ROLES)
    if (
      calendars.find(({ id }) => id === workspace.ownedCalendarIds[role])
        ?.accessRole !== "owner"
    )
      unsupported(
        `configured Owned ${role} calendar requires current accessRole owner`,
      );
}
function proposalIntent(proposal: CalendarProposalCandidate): unknown {
  const {
    review: _review,
    status: _status,
    liveVersions: _liveVersions,
    relevantAvailabilityVersion: _availability,
    conflictSummary: _conflicts,
    ...intent
  } = proposal;
  if (intent.operation === "bulk-create")
    return {
      ...intent,
      items: intent.items.map(
        ({ occupiedIntervals: _intervals, ...item }) => item,
      ),
    };
  return intent;
}
function refusal(
  outcome: "stale" | "blocked",
  reason: string,
  total = 0,
  accepted = 0,
): Extract<CalendarAssessment, { outcome: "stale" | "blocked" }> {
  return {
    outcome,
    reason,
    conflicts: [],
    warnings: [],
    acceptedStepCount: accepted,
    remainingStepCount: total - accepted,
  };
}
