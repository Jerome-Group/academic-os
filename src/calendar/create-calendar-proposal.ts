import { OperationalError } from "../operational-error.js";
import { restorableEvent } from "./calendar-event-helpers.js";
import {
  type ParsedCalendarActionProposalInput,
  type ParsedCalendarChangeProposalInput,
  parseCalendarAcademicTimetableProposalInput,
  parseCalendarChangeProposalInput,
  parseCalendarProposalInput,
  parseCalendarRoutineMigrationProposalInput,
} from "./calendar-proposal-input.js";
import { saveAssessedCalendarProposal } from "./save-assessed-calendar-proposal.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import { createAcademicTimetableProposal } from "./create-academic-timetable-proposal.js";
import { createRoutineMigrationProposal } from "./create-routine-migration-proposal.js";
import { readCurrentCalendarMirrors } from "./read-current-calendar-mirrors.js";
import {
  detectVisibleResearchProjectEvidenceStatus,
  validateResearchProjectMilestonePolicy,
} from "./research-project-milestone-policy.js";
import type {
  CalendarChangeProposalCandidate,
  CalendarEvent,
  CalendarListEntry,
  CalendarProposal,
  CalendarProposalCandidate,
  CalendarProposalReader,
  CalendarProposalStore,
  CalendarProposeReport,
  CalendarRecurrenceScope,
  OwnedCalendarMirror,
  OwnedCalendarMirrorStore,
  OwnedCalendarRole,
  OwnedCalendarWorkspaceReader,
} from "./types.js";

export { calendarStateDigest } from "./calendar-state-digest.js";

export async function createCalendarProposal(input: {
  value: unknown;
  reader: CalendarProposalReader;
  workspaceReader: OwnedCalendarWorkspaceReader;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
}): Promise<CalendarProposeReport> {
  const workspace = await input.workspaceReader.read();
  const routineMigrationInput = parseCalendarRoutineMigrationProposalInput(
    input.value,
  );
  if (routineMigrationInput !== undefined) {
    return await createRoutineMigrationProposal({
      value: routineMigrationInput,
      reader: input.reader,
      workspace,
      mirrorStore: input.mirrorStore,
      proposalStore: input.proposalStore,
    });
  }
  const academicTimetableInput = parseCalendarAcademicTimetableProposalInput(
    input.value,
    workspace.defaultTimezone,
  );
  if (academicTimetableInput !== undefined) {
    return await createAcademicTimetableProposal({
      value: academicTimetableInput,
      workspace,
      reader: input.reader,
      mirrorStore: input.mirrorStore,
      proposalStore: input.proposalStore,
    });
  }
  const changeInput = parseCalendarChangeProposalInput(input.value);
  if (changeInput !== undefined) {
    return await createActionProposal({
      workspace,
      reader: input.reader,
      mirrorStore: input.mirrorStore,
      proposalStore: input.proposalStore,
      actionInput: changeInput,
    });
  }
  const parsed = parseCalendarProposalInput(
    input.value,
    workspace.defaultTimezone,
  );
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    workspace,
  );
  const calendars = validateCalendars(await input.reader.listCalendars());
  const targetCalendarId = workspace.ownedCalendarIds[parsed.item.calendarRole];
  const targetCalendar = calendars.find(({ id }) => id === targetCalendarId);
  if (targetCalendar === undefined) {
    throw new OperationalError(
      "invalid-target",
      `The ${parsed.item.calendarRole} calendar is not visible in the current Calendar list.`,
    );
  }
  if (typeof targetCalendar.etag !== "string" || targetCalendar.etag === "") {
    throw new OperationalError(
      "operational-failure",
      `Calendar Propose received no live version for ${parsed.item.calendarRole}.`,
    );
  }

  const intentDigest = calendarStateDigest({
    operation: "create",
    source: parsed.source,
    itemKind: parsed.item.kind,
    target: {
      calendarRole: parsed.item.calendarRole,
      calendarId: targetCalendarId,
    },
    intendedEvent: parsed.item.intendedEvent,
  });
  const proposal: CalendarProposalCandidate = {
    id: `proposal-${intentDigest.slice(0, 24)}`,
    operation: "create",
    source: parsed.source,
    itemKind: parsed.item.kind,
    target: {
      calendarRole: parsed.item.calendarRole,
      calendarId: targetCalendarId,
    },
    intendedEvent: parsed.item.intendedEvent,
    travelBuffer: parsed.item.travelBuffer,
    inheritedDefaults: {
      calendarColorId: targetCalendar.colorId ?? null,
      reminders: validateReminders(targetCalendar.defaultReminders),
    },
    targetCalendarVersion: {
      calendarId: targetCalendarId,
      etag: targetCalendar.etag,
    },
    idempotencyKey: `create-${intentDigest}`,
    liveVersions: mirrors.map((mirror) => ({
      kind: "owned-mirror",
      calendarRole: mirror.role,
      calendarId: mirror.calendarId,
      syncToken: mirror.syncToken as string,
      lastSuccessfulRefresh: mirror.lastSuccessfulRefresh as string,
    })),
    relevantAvailabilityVersion: {
      digest: "",
      interval: null,
      checkedCalendarCount: 0,
    },
    conflictSummary: { blockers: 0, warnings: 0 },
  };
  return await saveAssessedCalendarProposal({
    proposal,
    workspace,
    mirrors,
    reader: input.reader,
    proposalStore: input.proposalStore,
  });
}

async function createActionProposal(input: {
  workspace: Awaited<ReturnType<OwnedCalendarWorkspaceReader["read"]>>;
  reader: CalendarProposalReader;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
  actionInput: ParsedCalendarActionProposalInput;
}): Promise<CalendarProposeReport> {
  if (input.actionInput.operation === "cancel") {
    return await createCancelProposal(
      input as typeof input & {
        actionInput: Extract<
          ParsedCalendarActionProposalInput,
          { operation: "cancel" }
        >;
      },
    );
  }
  if (input.actionInput.operation === "restore") {
    return await createRestoreProposal(
      input as typeof input & {
        actionInput: Extract<
          ParsedCalendarActionProposalInput,
          { operation: "restore" }
        >;
      },
    );
  }
  return await createChangeProposal({
    workspace: input.workspace,
    reader: input.reader,
    mirrorStore: input.mirrorStore,
    proposalStore: input.proposalStore,
    changeInput: input.actionInput,
  });
}

async function createCancelProposal(input: {
  reader: CalendarProposalReader;
  workspace: Awaited<ReturnType<OwnedCalendarWorkspaceReader["read"]>>;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
  actionInput: Extract<
    ParsedCalendarActionProposalInput,
    { operation: "cancel" }
  >;
}): Promise<CalendarProposeReport> {
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    input.workspace,
  );
  const { event, sourceMirror } = resolveActionTarget(
    mirrors,
    input.actionInput,
  );
  validateCancellationRecurrenceScope(event, input.actionInput.recurrenceScope);
  const targetEvent =
    input.actionInput.recurrenceScope === "entire-series" &&
    event.recurringEventId !== undefined
      ? sourceMirror.items.find(
          ({ event: candidate }) => candidate.id === event.recurringEventId,
        )?.event
      : event;
  if (targetEvent === undefined) {
    throw new OperationalError(
      "invalid-target",
      "The recurring master is not mirrored.",
    );
  }
  const digest = calendarStateDigest({
    operation: "cancel",
    event: targetEvent,
    scope: input.actionInput.recurrenceScope,
  });
  const proposal: CalendarProposal = {
    id: `proposal-${digest.slice(0, 24)}`,
    status: "ready",
    operation: "cancel",
    source: input.actionInput.source,
    itemKind: inferItemKind(targetEvent, input.actionInput.calendarRole),
    sourceItem: {
      calendarRole: input.actionInput.calendarRole,
      calendarId: sourceMirror.calendarId,
      eventId: targetEvent.id,
      versionDigest: calendarStateDigest(targetEvent),
      ...(event.recurringEventId === undefined
        ? {}
        : { recurringEventId: event.recurringEventId }),
    },
    target: {
      calendarRole: input.actionInput.calendarRole,
      calendarId: sourceMirror.calendarId,
    },
    ...(input.actionInput.recurrenceScope === undefined
      ? {}
      : { recurrenceScope: input.actionInput.recurrenceScope }),
    preview: {
      event: targetEvent,
      ...(input.actionInput.recurrenceScope === undefined
        ? {}
        : { recurrenceScope: input.actionInput.recurrenceScope }),
    },
    idempotencyKey: `cancel-${digest}`,
    liveVersions: liveVersions(mirrors),
    relevantAvailabilityVersion: {
      digest: calendarStateDigest([]),
      interval: null,
      checkedCalendarCount: 0,
    },
    conflictSummary: { blockers: 0, warnings: 0 },
  };
  return await saveAssessedCalendarProposal({
    proposal,
    workspace: input.workspace,
    mirrors,
    reader: input.reader,
    proposalStore: input.proposalStore,
  });
}

async function createRestoreProposal(input: {
  reader: CalendarProposalReader;
  workspace: Awaited<ReturnType<OwnedCalendarWorkspaceReader["read"]>>;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
  actionInput: Extract<
    ParsedCalendarActionProposalInput,
    { operation: "restore" }
  >;
}): Promise<CalendarProposeReport> {
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    input.workspace,
  );
  const mirror = mirrors.find(
    ({ role }) => role === input.actionInput.calendarRole,
  );
  const tombstone = mirror?.tombstones.find(
    ({ event }) => event.id === input.actionInput.eventId,
  );
  if (mirror === undefined || tombstone === undefined) {
    throw new OperationalError(
      "invalid-target",
      "Calendar Restore requires a retained Owned tombstone.",
    );
  }
  if (
    tombstone.access === "invited-read-only" ||
    (tombstone.access === undefined &&
      tombstone.event.organizer !== undefined &&
      tombstone.event.organizer.self !== true)
  ) {
    throw new OperationalError(
      "invalid-target",
      "Invited events cannot be restored through academic-os.",
    );
  }
  const digest = calendarStateDigest({ operation: "restore", tombstone });
  const idempotencyKey = `restore-${digest}`;
  const intendedEvent = restorableEvent(tombstone.event, idempotencyKey);
  const proposal: CalendarProposal = {
    id: `proposal-${digest.slice(0, 24)}`,
    status: "ready",
    operation: "restore",
    source: input.actionInput.source,
    itemKind: inferItemKind(intendedEvent, input.actionInput.calendarRole),
    target: {
      calendarRole: input.actionInput.calendarRole,
      calendarId: mirror.calendarId,
    },
    intendedEvent,
    restoredFrom: {
      calendarRole: input.actionInput.calendarRole,
      eventId: tombstone.event.id,
      deletedAt: tombstone.deletedAt,
    },
    idempotencyKey,
    liveVersions: liveVersions(mirrors),
    relevantAvailabilityVersion: {
      digest: calendarStateDigest([]),
      interval: null,
      checkedCalendarCount: 0,
    },
    conflictSummary: { blockers: 0, warnings: 0 },
  };
  return await saveAssessedCalendarProposal({
    proposal,
    workspace: input.workspace,
    mirrors,
    reader: input.reader,
    proposalStore: input.proposalStore,
  });
}

function resolveActionTarget(
  mirrors: OwnedCalendarMirror[],
  action: { calendarRole: OwnedCalendarRole; eventId: string },
) {
  const sourceMirror = mirrors.find(({ role }) => role === action.calendarRole);
  const sourceItem = sourceMirror?.items.find(
    ({ event }) => event.id === action.eventId,
  );
  if (sourceMirror === undefined || sourceItem === undefined) {
    throw new OperationalError(
      "invalid-target",
      "Calendar Proposal target is not a mirrored Owned item.",
    );
  }
  if (sourceItem.access !== "owned") {
    throw new OperationalError(
      "invalid-target",
      "Invited events cannot be cancelled through academic-os.",
    );
  }
  return { event: sourceItem.event, sourceMirror };
}

function validateCancellationRecurrenceScope(
  event: CalendarEvent,
  scope: CalendarRecurrenceScope | undefined,
): void {
  const recurring =
    event.recurringEventId !== undefined || (event.recurrence?.length ?? 0) > 0;
  if (recurring !== (scope !== undefined)) {
    throw new OperationalError(
      "invalid-target",
      recurring
        ? "Recurring cancellation requires exactly one recurrenceScope."
        : "A non-recurring cancellation cannot select recurrenceScope.",
    );
  }
}

function liveVersions(mirrors: OwnedCalendarMirror[]) {
  return mirrors.map((mirror) => ({
    kind: "owned-mirror" as const,
    calendarRole: mirror.role,
    calendarId: mirror.calendarId,
    syncToken: mirror.syncToken as string,
    lastSuccessfulRefresh: mirror.lastSuccessfulRefresh as string,
  }));
}

async function createChangeProposal(input: {
  workspace: Awaited<ReturnType<OwnedCalendarWorkspaceReader["read"]>>;
  reader: CalendarProposalReader;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
  changeInput: ParsedCalendarChangeProposalInput;
}): Promise<CalendarProposeReport> {
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    input.workspace,
  );
  const { event, sourceMirror } = resolveChangeTarget(
    mirrors,
    input.changeInput,
  );
  const targetRole =
    input.changeInput.targetCalendarRole ?? input.changeInput.calendarRole;
  const targetCalendarId = input.workspace.ownedCalendarIds[targetRole];
  const sourceCalendarId =
    input.workspace.ownedCalendarIds[input.changeInput.calendarRole];
  const operation =
    targetRole === input.changeInput.calendarRole ? "update" : "move";
  const intent = {
    operation,
    source: input.changeInput.source,
    sourceCalendarId,
    eventId: event.id,
    targetCalendarId,
    patch: input.changeInput.patch,
    recurrenceScope: input.changeInput.recurrenceScope,
  };
  const digest = calendarStateDigest(intent);
  const targetEvent =
    input.changeInput.recurrenceScope === "entire-series" &&
    event.recurringEventId !== undefined
      ? (sourceMirror.items.find(
          ({ event: candidate }) => candidate.id === event.recurringEventId,
        )?.event ?? event)
      : event;
  const projectedEvent = { ...targetEvent, ...input.changeInput.patch };
  const projectedItemKind = inferItemKind(projectedEvent, targetRole);
  const recurringMaster =
    event.recurringEventId === undefined
      ? undefined
      : sourceMirror.items.find(
          ({ event: candidate }) => candidate.id === event.recurringEventId,
        )?.event;
  if (
    input.changeInput.recurrenceScope === "entire-series" &&
    event.recurringEventId !== undefined &&
    recurringMaster === undefined
  ) {
    throw new OperationalError(
      "invalid-target",
      "An entire-series Proposal requires its mirrored recurring master.",
    );
  }
  const visibleEvidenceStatus =
    detectVisibleResearchProjectEvidenceStatus(event) ??
    (recurringMaster === undefined
      ? undefined
      : detectVisibleResearchProjectEvidenceStatus(recurringMaster)) ??
    detectVisibleResearchProjectEvidenceStatus(projectedEvent);
  validateResearchProjectMilestonePolicy({
    source: input.changeInput.source,
    evidenceStatus: input.changeInput.evidenceStatus,
    description: projectedEvent.description,
    summary: projectedEvent.summary,
    calendarRole: targetRole,
    itemKind: projectedItemKind,
    visibility: projectedEvent.visibility,
    recurring:
      input.changeInput.recurrenceScope !== undefined ||
      projectedEvent.recurrence !== undefined ||
      event.recurringEventId !== undefined,
    visibleEvidenceStatus,
  });
  const proposal: CalendarChangeProposalCandidate & { status: "ready" } = {
    id: `proposal-${digest.slice(0, 24)}`,
    status: "ready",
    operation,
    source: input.changeInput.source,
    itemKind: projectedItemKind,
    sourceItem: {
      calendarRole: input.changeInput.calendarRole,
      calendarId: sourceCalendarId,
      eventId: event.id,
      versionDigest: calendarStateDigest(event),
      ...(typeof event.recurringEventId === "string"
        ? { recurringEventId: event.recurringEventId }
        : {}),
    },
    target: { calendarRole: targetRole, calendarId: targetCalendarId },
    patch: input.changeInput.patch,
    ...(input.changeInput.recurrenceScope === undefined
      ? {}
      : { recurrenceScope: input.changeInput.recurrenceScope }),
    idempotencyKey: `${operation}-${digest}`,
    liveVersions: mirrors.map((mirror) => ({
      kind: "owned-mirror",
      calendarRole: mirror.role,
      calendarId: mirror.calendarId,
      syncToken: mirror.syncToken as string,
      lastSuccessfulRefresh: mirror.lastSuccessfulRefresh as string,
    })),
    relevantAvailabilityVersion: {
      digest: "",
      interval: null,
      checkedCalendarCount: 0,
    },
    conflictSummary: { blockers: 0, warnings: 0 },
  };
  return await saveAssessedCalendarProposal({
    proposal,
    workspace: input.workspace,
    mirrors,
    reader: input.reader,
    proposalStore: input.proposalStore,
  });
}

function resolveChangeTarget(
  mirrors: OwnedCalendarMirror[],
  change: ParsedCalendarChangeProposalInput,
): { event: CalendarEvent; sourceMirror: OwnedCalendarMirror } {
  const sourceMirror = mirrors.find(({ role }) => role === change.calendarRole);
  const sourceItem = sourceMirror?.items.find(
    ({ event }) => event.id === change.eventId,
  );
  if (sourceMirror === undefined || sourceItem === undefined) {
    throw new OperationalError(
      "invalid-target",
      "Calendar Proposal target is not a mirrored Owned item.",
    );
  }
  if (sourceItem.access !== "owned") {
    throw new OperationalError(
      "invalid-target",
      "Invited events are read-only and cannot be changed by Calendar Promotion.",
    );
  }
  validateRecurrenceScope(sourceItem.event, change.recurrenceScope);
  return { event: sourceItem.event, sourceMirror };
}

function validateRecurrenceScope(
  event: CalendarEvent,
  scope: ParsedCalendarChangeProposalInput["recurrenceScope"],
): void {
  const recurring =
    event.recurrence !== undefined || event.recurringEventId !== undefined;
  if (recurring !== (scope !== undefined)) {
    throw new OperationalError(
      "invalid-target",
      recurring
        ? "Recurring Calendar changes require exactly one recurrenceScope."
        : "recurrenceScope is valid only for recurring Calendar items.",
    );
  }
  if (
    scope !== undefined &&
    scope !== "entire-series" &&
    event.recurringEventId === undefined
  ) {
    throw new OperationalError(
      "invalid-target",
      `${scope} requires a mirrored recurring occurrence.`,
    );
  }
}

function inferItemKind(event: CalendarEvent, role: OwnedCalendarRole) {
  if (role === "Routine") return "routine-event" as const;
  if (event.transparency === "transparent") {
    return event.start?.date === undefined
      ? ("timed-milestone" as const)
      : ("all-day-milestone" as const);
  }
  return "fixed-event" as const;
}

function validateCalendars(value: CalendarListEntry[]): CalendarListEntry[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (calendar) =>
        typeof calendar.id !== "string" ||
        calendar.id === "" ||
        typeof calendar.summary !== "string",
    )
  ) {
    throw new OperationalError(
      "operational-failure",
      "Calendar Propose received an invalid Calendar list.",
    );
  }
  return value;
}

function validateReminders(
  value: CalendarListEntry["defaultReminders"],
): Array<{ method: string; minutes: number }> {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (reminder) =>
        typeof reminder.method !== "string" ||
        !Number.isInteger(reminder.minutes) ||
        reminder.minutes < 0,
    )
  ) {
    throw new OperationalError(
      "operational-failure",
      "Calendar Propose received invalid inherited reminders.",
    );
  }
  return value;
}
