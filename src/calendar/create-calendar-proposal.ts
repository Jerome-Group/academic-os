import { createHash } from "node:crypto";

import { OperationalError } from "../operational-error.js";
import {
  addTravelBuffer,
  collectCalendarAvailability,
  findCalendarOverlaps,
} from "./calendar-conflicts.js";
import {
  parseCalendarChangeProposalInput,
  parseCalendarProposalInput,
  type ParsedCalendarChangeProposalInput,
} from "./calendar-proposal-input.js";
import type {
  CalendarChangeProposalCandidate,
  CalendarEvent,
  CalendarInterval,
  CalendarListEntry,
  CalendarProposal,
  CalendarProposalCandidate,
  CalendarProposalReader,
  CalendarProposalStore,
  CalendarProposeReport,
  OwnedCalendarMirror,
  OwnedCalendarMirrorStore,
  OwnedCalendarRole,
  OwnedCalendarWorkspaceReader,
} from "./types.js";
import { OWNED_CALENDAR_ROLES } from "./types.js";
import { trimCalendarRecurrence } from "./calendar-recurrence.js";

export async function createCalendarProposal(input: {
  value: unknown;
  reader: CalendarProposalReader;
  workspaceReader: OwnedCalendarWorkspaceReader;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
}): Promise<CalendarProposeReport> {
  const workspace = await input.workspaceReader.read();
  const changeInput = parseCalendarChangeProposalInput(input.value);
  if (changeInput !== undefined) {
    return await createChangeProposal({
      workspace,
      reader: input.reader,
      mirrorStore: input.mirrorStore,
      proposalStore: input.proposalStore,
      changeInput,
    });
  }
  const parsed = parseCalendarProposalInput(
    input.value,
    workspace.defaultTimezone,
  );
  const mirrors = await readCurrentMirrors(input.mirrorStore, workspace);
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

  const checkedInterval = addTravelBuffer(
    parsed.item.occupiedInterval,
    parsed.item.travelBuffer,
  );
  const availability =
    checkedInterval === null
      ? { items: [], checkedCalendarCount: 0 }
      : await collectCalendarAvailability({
          reader: input.reader,
          calendars,
          mirrors,
          ownedCalendarIds: workspace.ownedCalendarIds,
          interval: checkedInterval,
        });
  const overlaps = findCalendarOverlaps({
    availability: availability.items,
    interval: checkedInterval,
    proposedKind: parsed.item.kind,
  });
  const conflicts = overlaps.filter(({ severity }) => severity === "block");
  const warnings = overlaps.filter(({ severity }) => severity === "warning");
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
    ...(conflicts.length === 0 ? { status: "ready" as const } : {}),
    operation: "create",
    source: parsed.source,
    itemKind: parsed.item.kind,
    target: {
      calendarRole: parsed.item.calendarRole,
      calendarId: targetCalendarId,
    },
    intendedEvent: parsed.item.intendedEvent,
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
      digest: calendarStateDigest(
        availability.items.map(({ calendarId, event }) => ({
          calendarId,
          event,
        })),
      ),
      interval: checkedInterval,
      checkedCalendarCount: availability.checkedCalendarCount,
    },
    conflictSummary: {
      blockers: conflicts.length,
      warnings: warnings.length,
    },
  };
  const ready = conflicts.length === 0;
  if (ready) {
    const readyProposal: CalendarProposal = { ...proposal, status: "ready" };
    await input.proposalStore.writeCurrent(readyProposal);
  }
  return {
    schemaVersion: 1,
    command: "calendar propose",
    outcome: ready ? "ready" : "blocked",
    proposal,
    conflicts,
    warnings,
    workspace: ready ? "written" : "not-written",
  };
}

async function createChangeProposal(input: {
  workspace: Awaited<ReturnType<OwnedCalendarWorkspaceReader["read"]>>;
  reader: CalendarProposalReader;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
  changeInput: ParsedCalendarChangeProposalInput;
}): Promise<CalendarProposeReport> {
  const mirrors = await readCurrentMirrors(input.mirrorStore, input.workspace);
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
  const futureState =
    input.changeInput.recurrenceScope === "this-and-future"
      ? recurringFutureState(sourceMirror, event)
      : undefined;
  const projectedEvent = { ...event, ...input.changeInput.patch };
  const availability = await prepareChangeAvailability({
    reader: input.reader,
    mirrors,
    ownedCalendarIds: input.workspace.ownedCalendarIds,
    sourceCalendarId,
    sourceEvent: event,
    projectedEvent,
    targetRole,
  });
  const proposal: CalendarChangeProposalCandidate & { status: "ready" } = {
    id: `proposal-${digest.slice(0, 24)}`,
    status: "ready",
    operation,
    source: input.changeInput.source,
    itemKind: inferItemKind(projectedEvent, targetRole),
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
    ...(futureState ?? {}),
    idempotencyKey: `${operation}-${digest}`,
    liveVersions: mirrors.map((mirror) => ({
      kind: "owned-mirror",
      calendarRole: mirror.role,
      calendarId: mirror.calendarId,
      syncToken: mirror.syncToken as string,
      lastSuccessfulRefresh: mirror.lastSuccessfulRefresh as string,
    })),
    relevantAvailabilityVersion: {
      digest: calendarStateDigest(
        availability.items.map(({ calendarId, event: relevantEvent }) => ({
          calendarId,
          event: relevantEvent,
        })),
      ),
      interval: availability.interval,
      checkedCalendarCount: availability.checkedCalendarCount,
    },
    conflictSummary: {
      blockers: availability.conflicts.length,
      warnings: availability.warnings.length,
    },
  };
  if (availability.conflicts.length === 0) {
    await input.proposalStore.writeCurrent(proposal);
  }
  return {
    schemaVersion: 1,
    command: "calendar propose",
    outcome: availability.conflicts.length === 0 ? "ready" : "blocked",
    proposal,
    conflicts: availability.conflicts,
    warnings: availability.warnings,
    workspace: availability.conflicts.length === 0 ? "written" : "not-written",
  };
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

async function prepareChangeAvailability(input: {
  reader: CalendarProposalReader;
  mirrors: OwnedCalendarMirror[];
  ownedCalendarIds: Record<OwnedCalendarRole, string>;
  sourceCalendarId: string;
  sourceEvent: CalendarEvent;
  projectedEvent: CalendarEvent;
  targetRole: OwnedCalendarRole;
}) {
  const interval = intervalFor(input.projectedEvent);
  const calendars = await input.reader.listCalendars();
  const availability =
    interval === null
      ? { items: [], checkedCalendarCount: 0 }
      : await collectCalendarAvailability({
          reader: input.reader,
          calendars,
          mirrors: input.mirrors,
          ownedCalendarIds: input.ownedCalendarIds,
          interval,
        });
  const items = availability.items.filter(
    ({ calendarId, event }) =>
      calendarId !== input.sourceCalendarId ||
      (event.id !== input.sourceEvent.id &&
        event.id !== input.sourceEvent.recurringEventId),
  );
  const overlaps = findCalendarOverlaps({
    availability: items,
    interval,
    proposedKind: inferItemKind(input.projectedEvent, input.targetRole),
  });
  return {
    items,
    interval,
    checkedCalendarCount: availability.checkedCalendarCount,
    conflicts: overlaps.filter(({ severity }) => severity === "block"),
    warnings: overlaps.filter(({ severity }) => severity === "warning"),
  };
}

function recurringFutureState(
  mirror: OwnedCalendarMirror,
  target: CalendarEvent,
): Pick<
  CalendarChangeProposalCandidate,
  "recurrenceExceptions" | "recurringMaster" | "recurrenceDependencies"
> {
  const boundary =
    target.originalStartTime?.dateTime ??
    target.originalStartTime?.date ??
    target.start?.dateTime ??
    target.start?.date;
  const master = mirror.items.find(
    ({ event }) => event.id === target.recurringEventId,
  )?.event;
  if (
    target.recurringEventId === undefined ||
    boundary === undefined ||
    master?.recurrence === undefined
  ) {
    throw new OperationalError(
      "invalid-target",
      "This-and-future Proposal requires its mirrored recurring master.",
    );
  }
  const exceptions = mirror.items
    .map(({ event }) => event)
    .filter(
      (event) =>
        event.id !== target.id &&
        event.recurringEventId === target.recurringEventId &&
        (event.originalStartTime?.dateTime ?? event.start?.dateTime ?? "") >=
          boundary,
    );
  return {
    recurrenceExceptions: exceptions,
    recurringMaster: master,
    recurrenceDependencies: [master, ...exceptions].map((dependency) => ({
      eventId: dependency.id,
      versionDigest: calendarStateDigest(dependency),
      ...(dependency.id === master.id
        ? {
            acceptedTrimmedDigest: calendarStateDigest({
              ...dependency,
              recurrence: trimCalendarRecurrence(
                dependency.recurrence ?? [],
                boundary,
              ),
            }),
          }
        : {}),
    })),
  };
}

function intervalFor(event: CalendarEvent): CalendarInterval | null {
  const start = event.start?.dateTime;
  const end = event.end?.dateTime;
  return typeof start === "string" && typeof end === "string"
    ? { start, end }
    : null;
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

async function readCurrentMirrors(
  mirrorStore: OwnedCalendarMirrorStore,
  workspace: Awaited<ReturnType<OwnedCalendarWorkspaceReader["read"]>>,
): Promise<OwnedCalendarMirror[]> {
  const mirrors: OwnedCalendarMirror[] = [];
  for (const role of OWNED_CALENDAR_ROLES) {
    const mirror = await mirrorStore.read(role);
    if (
      mirror === undefined ||
      mirror.freshness !== "fresh" ||
      mirror.calendarId !== workspace.ownedCalendarIds[role] ||
      typeof mirror.syncToken !== "string" ||
      typeof mirror.lastSuccessfulRefresh !== "string"
    ) {
      throw new OperationalError(
        "operational-failure",
        `Calendar Refresh must succeed for ${role} before preparing a Proposal.`,
      );
    }
    mirrors.push(mirror);
  }
  return mirrors;
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

export function calendarStateDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
