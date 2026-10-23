import { isDeepStrictEqual } from "node:util";
import { OperationalError } from "../operational-error.js";
import {
  idempotentExtendedProperties,
  restorableEvent,
  sortedRecurrence,
} from "./calendar-event-helpers.js";
import {
  calendarGeometry,
  expandCalendarEvent,
  originalCalendarStart,
  validateCalendarGeometry,
  type CalendarOccurrence,
} from "./calendar-occurrences.js";
import { calendarEventIdFor } from "./calendar-idempotency.js";
import { parseCalendarAcademicTimetableProposalInput } from "./calendar-proposal-input.js";
import {
  futureCalendarRecurrence,
  trimCalendarRecurrence,
} from "./calendar-recurrence.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import { NTU_AY2026_27_SEMESTER_1 } from "./ntu-academic-calendar.js";
import type {
  CalendarEvent,
  CalendarEventPatch,
  CalendarInterval,
  CalendarListEntry,
  CalendarProposalCandidate,
  OwnedCalendarRole,
  OwnedCalendarWorkspace,
} from "./types.js";

export const calendarTimetableMapVersion = () =>
  calendarStateDigest(NTU_AY2026_27_SEMESTER_1);

export interface EventRef {
  calendarId: string;
  eventId: string;
}
export interface InstanceRef {
  calendarId: string;
  seriesId: string;
  originalStart: string;
}
export type Ref = EventRef | InstanceRef;
export interface Original {
  ref: EventRef;
  event: CalendarEvent;
}
export interface SeriesInventory {
  ref: EventRef;
  events: CalendarEvent[];
}
export interface Occupant {
  key: string;
  originalStart: string;
  role: OwnedCalendarRole;
  interval: CalendarInterval;
}
export interface State {
  ref: Ref;
  event: CalendarEvent | null;
  version?: string;
  allowOriginal?: CalendarEvent;
}
export type Step =
  | {
      kind: "create";
      ref: EventRef;
      event: CalendarEvent;
      idempotencyKey: string;
      changes: State[];
    }
  | {
      kind: "patch";
      ref: Ref;
      patch: CalendarEventPatch | CalendarEvent;
      changes: State[];
    }
  | { kind: "move"; ref: EventRef; targetCalendarId: string; changes: State[] }
  | { kind: "delete"; ref: Ref; changes: State[] };
export interface Plan {
  initial: State[];
  steps: Step[];
  occupants: Occupant[];
  exclusions: Array<{
    calendarId: string;
    eventId: string;
    scope: "event" | "series" | "future";
    boundary?: string;
  }>;
  results: EventRef[];
  coverage: "complete-finite" | "not-required";
  reason?: "cancellation" | "milestone" | "routine" | "occupancy-preserving";
  warningCoverage: "complete-finite" | "anchor-only" | "not-enumerated";
  restorationScope?: "retained-resource-only";
}

export function compilePlan(
  proposal: CalendarProposalCandidate,
  workspace: OwnedCalendarWorkspace,
  calendars: CalendarListEntry[],
  originals: Original[],
  inventories: SeriesInventory[],
): Plan {
  const plan: Plan = {
    initial: [],
    steps: [],
    occupants: [],
    exclusions: [],
    results: [],
    coverage: "complete-finite",
    warningCoverage: "complete-finite",
  };
  const zone = calendars.find(
    ({ id }) => id === proposal.target.calendarId,
  )?.timeZone;
  const addCreate = (
    key: string,
    event: CalendarEvent,
    idempotencyKey: string,
    role: OwnedCalendarRole,
    calendarId: string,
    buffer = { beforeMinutes: 0, afterMinutes: 0 },
  ) => {
    const ref = { calendarId, eventId: calendarEventIdFor(idempotencyKey) };
    const intended = {
      ...event,
      id: ref.eventId,
      extendedProperties: idempotentExtendedProperties(event, idempotencyKey),
    };
    plan.initial.push({ ref, event: null });
    plan.steps.push({
      kind: "create",
      ref,
      event: intended,
      idempotencyKey,
      changes: [{ ref, event: intended }],
    });
    plan.results.push(ref);
    addOccupancy(plan, key, intended, role, zone, buffer);
  };
  if (proposal.operation === "create" || proposal.operation === "restore") {
    const event: CalendarEvent =
      proposal.operation === "restore"
        ? restorableEvent(proposal.intendedEvent, proposal.idempotencyKey)
        : {
            ...proposal.intendedEvent,
            id: calendarEventIdFor(proposal.idempotencyKey),
          };
    if (proposal.operation === "restore")
      plan.restorationScope = "retained-resource-only";
    addCreate(
      proposal.id,
      event,
      proposal.idempotencyKey,
      proposal.target.calendarRole,
      proposal.target.calendarId,
      proposal.operation === "create" ? proposal.travelBuffer : undefined,
    );
    return plan;
  }
  if (proposal.operation === "bulk-create") {
    if (
      proposal.timetableRecipe === undefined ||
      proposal.timetableMapVersion !== calendarTimetableMapVersion()
    )
      unsupported("timetable recipe/map version requires re-preview");
    const parsed = parseCalendarAcademicTimetableProposalInput(
      proposal.timetableRecipe,
      workspace.defaultTimezone,
    );
    if (parsed === undefined || parsed.items.length !== proposal.items.length)
      unsupported("invalid canonical timetable recipe");
    for (const item of parsed.items) {
      const savedItem = proposal.items.find(({ key }) => key === item.key);
      const idempotencyKey = `${proposal.idempotencyKey}:${item.key}`;
      if (
        savedItem === undefined ||
        savedItem.idempotencyKey !== idempotencyKey ||
        savedItem.eventId !== calendarEventIdFor(idempotencyKey) ||
        !isDeepStrictEqual(savedItem.intendedEvent, item.intendedEvent)
      )
        unsupported("timetable payload differs from canonical recipe");
      addCreate(
        item.key,
        { id: savedItem.eventId, ...item.intendedEvent },
        idempotencyKey,
        proposal.target.calendarRole,
        proposal.target.calendarId,
      );
    }
    return plan;
  }
  if (proposal.operation === "routine-migration") {
    plan.coverage = "not-required";
    plan.reason = "routine";
    plan.warningCoverage = "not-enumerated";
    for (const move of proposal.moves)
      compileChange(
        plan,
        {
          ...move,
          operation: "move",
          id: proposal.id,
          idempotencyKey: `${proposal.idempotencyKey}:${move.sourceItem.eventId}`,
          itemKind: "routine-event",
          source: proposal.source,
          liveVersions: proposal.liveVersions,
          relevantAvailabilityVersion: proposal.relevantAvailabilityVersion,
          conflictSummary: proposal.conflictSummary,
        },
        workspace,
        calendars,
        originals,
        inventories,
      );
    return plan;
  }
  compileChange(plan, proposal, workspace, calendars, originals, inventories);
  return plan;
}

function compileChange(
  plan: Plan,
  proposal: Extract<
    CalendarProposalCandidate,
    { operation: "update" | "move" | "cancel" }
  >,
  workspace: OwnedCalendarWorkspace,
  calendars: CalendarListEntry[],
  originals: Original[],
  inventories: SeriesInventory[],
): void {
  if (
    proposal.sourceItem.calendarId !==
    workspace.ownedCalendarIds[proposal.sourceItem.calendarRole]
  )
    unsupported("source is not the exact configured Owned calendar");
  const selected = originalEvent(
    originals,
    proposal.sourceItem.calendarId,
    proposal.sourceItem.eventId,
  );
  if (calendarStateDigest(selected) !== proposal.sourceItem.versionDigest)
    unsupported("source snapshot does not match its reviewed version");
  const recurring =
    selected.recurringEventId !== undefined ||
    (selected.recurrence?.length ?? 0) > 0;
  if (recurring !== (proposal.recurrenceScope !== undefined))
    unsupported("recurring changes require exactly one recurrenceScope");
  if (
    proposal.recurrenceScope !== undefined &&
    proposal.recurrenceScope !== "entire-series" &&
    selected.recurringEventId === undefined
  )
    unsupported("occurrence scope requires an actual recurring instance");
  const masterId = selected.recurringEventId ?? selected.id;
  const whole = proposal.recurrenceScope === "entire-series";
  const future = proposal.recurrenceScope === "this-and-future";
  const event =
    whole || future
      ? originalEvent(originals, proposal.sourceItem.calendarId, masterId)
      : selected;
  const ref = { calendarId: proposal.sourceItem.calendarId, eventId: event.id };
  const targetZone = calendars.find(
    ({ id }) => id === proposal.target.calendarId,
  )?.timeZone;
  const sourceZone = calendars.find(
    ({ id }) => id === ref.calendarId,
  )?.timeZone;
  const inventory = inventories.find(
    ({ ref: item }) =>
      item.calendarId === ref.calendarId && item.eventId === event.id,
  );
  const members = inventory?.events.filter(({ id }) => id !== event.id) ?? [];
  addOriginal(plan, ref, event);
  for (const member of members)
    addOriginal(
      plan,
      { calendarId: ref.calendarId, eventId: member.id },
      member,
    );
  if (proposal.operation === "cancel") {
    plan.coverage = "not-required";
    plan.reason = "cancellation";
    plan.warningCoverage = "not-enumerated";
    if (future) {
      const boundary = originalCalendarStart(selected);
      if (event.recurrence === undefined)
        unsupported("future cancellation requires a recurring master");
      const selectedRef = { calendarId: ref.calendarId, eventId: selected.id };
      addOriginal(plan, selectedRef, selected);
      const futureMembers = [
        ...members.filter((member) => atOrAfter(member, boundary)),
        ...(members.some(({ id }) => id === selected.id) ? [] : [selected]),
      ];
      if (
        sameOriginal(event.start?.date ?? event.start?.dateTime ?? "", boundary)
      ) {
        plan.steps.push({
          kind: "delete",
          ref,
          changes: [
            { ref, event: null },
            ...futureMembers.map((member) => ({
              ref: { calendarId: ref.calendarId, eventId: member.id },
              event: null,
            })),
          ],
        });
        return;
      }
      const patch = {
        recurrence: trimCalendarRecurrence(event.recurrence, boundary),
      };
      plan.steps.push({
        kind: "patch",
        ref,
        patch,
        changes: [
          { ref, event: { ...event, ...patch } },
          ...futureMembers.map((member) => ({
            ref: { calendarId: ref.calendarId, eventId: member.id },
            event: null,
            allowOriginal: member,
          })),
        ],
      });
      for (const exception of futureMembers) {
        const child = { calendarId: ref.calendarId, eventId: exception.id };
        addOriginal(plan, child, exception);
        if (exception.status !== "cancelled")
          plan.steps.push({
            kind: "delete",
            ref: child,
            changes: [{ ref: child, event: null }],
          });
      }
      plan.results.push(ref);
    } else {
      plan.steps.push({
        kind: "delete",
        ref,
        changes: [
          { ref, event: null },
          ...members.map((member) => ({
            ref: { calendarId: ref.calendarId, eventId: member.id },
            event: null,
          })),
        ],
      });
      for (const member of members)
        addOriginal(
          plan,
          { calendarId: ref.calendarId, eventId: member.id },
          member,
        );
    }
    return;
  }
  if (
    proposal.recurrenceScope === "this-occurrence" &&
    proposal.patch.recurrence !== undefined
  )
    unsupported("a selected occurrence cannot change recurrence");
  if (future) {
    if (
      event.recurrence === undefined ||
      selected.recurringEventId !== event.id
    )
      unsupported("future change requires a recurring occurrence and master");
    const boundary = originalCalendarStart(selected);
    const prefix = expandCalendarEvent(event, sourceZone, boundary);
    const position = prefix.positions.find((candidate) =>
      sameOriginal(candidate.originalStart, boundary),
    );
    if (position === undefined)
      unsupported(
        "selected original start does not belong to the supported recurrence",
      );
    const recurrence =
      proposal.patch.recurrence ??
      futureCalendarRecurrence(event.recurrence, position.ordinal);
    const newRef = {
      calendarId: proposal.target.calendarId,
      eventId: calendarEventIdFor(proposal.idempotencyKey),
    };
    if (
      selected.start === undefined ||
      selected.end === undefined ||
      selected.originalStartTime === undefined
    )
      unsupported("future occurrence has incomplete geometry");
    const futureEvent: CalendarEvent = {
      ...restorableEvent(event, proposal.idempotencyKey),
      id: newRef.eventId,
      start: selected.start,
      end: selected.end,
      ...proposal.patch,
      recurrence,
    };
    const futureMembers = members.filter(
      (member) => atOrAfter(member, boundary) && member.id !== selected.id,
    );
    const preservedGeometry =
      proposal.patch.recurrence === undefined &&
      sameSchedule(
        {
          ...event,
          start: selected.originalStartTime,
          ...(endAtOriginal(event, selected.originalStartTime, sourceZone) ===
          undefined
            ? {}
            : {
                end:
                  endAtOriginal(
                    event,
                    selected.originalStartTime,
                    sourceZone,
                  ) ?? {},
              }),
        },
        futureEvent,
        sourceZone,
      ) &&
      sourceZone === targetZone;
    if (futureMembers.length > 0 && !preservedGeometry)
      unsupported(
        "detached future exceptions cannot be remapped exactly after changing recurrence or its anchor",
      );
    const trimmed = {
      recurrence: trimCalendarRecurrence(event.recurrence, boundary),
    };
    const selectedRef = { calendarId: ref.calendarId, eventId: selected.id };
    addOriginal(plan, selectedRef, selected);
    const trimChanges: State[] = [
      { ref, event: { ...event, ...trimmed } },
      { ref: selectedRef, event: null, allowOriginal: selected },
    ];
    for (const member of futureMembers) {
      const childRef = { calendarId: ref.calendarId, eventId: member.id };
      addOriginal(plan, childRef, member);
      trimChanges.push({ ref: childRef, event: null, allowOriginal: member });
    }
    plan.steps.push(
      position.ordinal === 0
        ? {
            kind: "delete",
            ref,
            changes: trimChanges.map((state) =>
              refKey(state.ref) === refKey(ref) ? { ref, event: null } : state,
            ),
          }
        : { kind: "patch", ref, patch: trimmed, changes: trimChanges },
    );
    plan.steps.push({
      kind: "delete",
      ref: selectedRef,
      changes: [{ ref: selectedRef, event: null }],
    });
    for (const member of futureMembers) {
      if (member.status === "cancelled") continue;
      const childRef = { calendarId: ref.calendarId, eventId: member.id };
      plan.steps.push({
        kind: "delete",
        ref: childRef,
        changes: [{ ref: childRef, event: null }],
      });
    }
    const childStates: State[] = [];
    const replays: Step[] = [];
    for (const member of futureMembers) {
      const originalStart = originalCalendarStart(member);
      const child: InstanceRef = {
        calendarId: newRef.calendarId,
        seriesId: newRef.eventId,
        originalStart,
      };
      const expanded = expandCalendarEvent(
        futureEvent,
        targetZone,
        originalStart,
      );
      const occurrence = expanded.occurrences.find((candidate) =>
        sameOriginal(candidate.originalStart, originalStart),
      );
      if (occurrence === undefined)
        unsupported("future exception has no exact replacement occurrence");
      const baseline = eventAtOccurrence(futureEvent, occurrence);
      plan.initial.push({ ref: child, event: null });
      childStates.push({ ref: child, event: baseline });
      if (member.status === "cancelled")
        replays.push({
          kind: "delete",
          ref: child,
          changes: [{ ref: child, event: null }],
        });
      else {
        const patch = exceptionPatch(member);
        replays.push({
          kind: "patch",
          ref: child,
          patch,
          changes: [{ ref: child, event: { ...baseline, ...patch } }],
        });
      }
    }
    plan.initial.push({ ref: newRef, event: null });
    plan.steps.push(
      {
        kind: "create",
        ref: newRef,
        event: futureEvent,
        idempotencyKey: proposal.idempotencyKey,
        changes: [{ ref: newRef, event: futureEvent }, ...childStates],
      },
      ...replays,
    );
    plan.exclusions.push({
      calendarId: ref.calendarId,
      eventId: event.id,
      scope: "future",
      boundary,
    });
    plan.results.push(newRef);
    if (
      preservedGeometry &&
      proposal.target.calendarRole !== "Routine" &&
      proposal.sourceItem.calendarRole !== "Routine"
    ) {
      plan.coverage = "not-required";
      plan.reason = "occupancy-preserving";
      plan.warningCoverage = "not-enumerated";
    } else
      addOccupancy(
        plan,
        proposal.id,
        futureEvent,
        proposal.target.calendarRole,
        targetZone,
        undefined,
        futureMembers,
      );
    return;
  }
  const projected = { ...event, ...proposal.patch };
  validateCalendarGeometry(event);
  validateCalendarGeometry(projected);
  const unchanged =
    sameGeometry(event, projected) &&
    (event.start?.date === undefined || sourceZone === targetZone) &&
    proposal.sourceItem.calendarRole !== "Routine" &&
    proposal.target.calendarRole !== "Routine" &&
    event.transparency !== "transparent" &&
    projected.transparency !== "transparent";
  if (
    proposal.operation === "move" &&
    event.start?.date !== undefined &&
    projected.transparency !== "transparent" &&
    proposal.target.calendarRole !== "Routine" &&
    (sourceZone === undefined || targetZone === undefined)
  )
    unsupported(
      "all-day moves require actual source and target calendar timezones",
    );
  const introducesBlocking =
    projected.transparency !== "transparent" &&
    proposal.target.calendarRole !== "Routine" &&
    (event.transparency === "transparent" ||
      proposal.sourceItem.calendarRole === "Routine");
  const needsInventory =
    whole &&
    (proposal.operation === "move" ||
      !sameGeometry(event, projected) ||
      introducesBlocking);
  if (needsInventory && inventory === undefined)
    unsupported("complete stored source-series inventory is required");
  if (whole && !sameGeometry(event, projected) && members.length > 0)
    unsupported(
      "detached series exceptions cannot be remapped exactly after changing recurrence geometry",
    );
  const patchRef = {
    calendarId: proposal.target.calendarId,
    eventId: event.id,
  };
  if (proposal.operation === "move") {
    plan.initial.push({ ref: patchRef, event: null });
    const changes: State[] = [
      { ref, event: null },
      { ref: patchRef, event },
    ];
    for (const member of members) {
      const from = { calendarId: ref.calendarId, eventId: member.id };
      const to = { calendarId: patchRef.calendarId, eventId: member.id };
      addOriginal(plan, from, member);
      plan.initial.push({ ref: to, event: null });
      changes.push({ ref: from, event: null }, { ref: to, event: member });
    }
    plan.steps.push({
      kind: "move",
      ref,
      targetCalendarId: patchRef.calendarId,
      changes,
    });
  }
  if (Object.keys(proposal.patch).length > 0)
    plan.steps.push({
      kind: "patch",
      ref: patchRef,
      patch: proposal.patch,
      changes: [{ ref: patchRef, event: projected }],
    });
  plan.results.push(patchRef);
  plan.exclusions.push({
    calendarId: ref.calendarId,
    eventId: whole ? event.id : selected.id,
    scope: whole ? "series" : "event",
  });
  if (unchanged) {
    plan.coverage = "not-required";
    plan.reason = "occupancy-preserving";
    plan.warningCoverage = "not-enumerated";
  } else
    addOccupancy(
      plan,
      proposal.id,
      projected,
      proposal.target.calendarRole,
      targetZone,
      undefined,
      members,
    );
}

function addOccupancy(
  plan: Plan,
  key: string,
  event: CalendarEvent,
  role: OwnedCalendarRole,
  zone: string | undefined,
  buffer = { beforeMinutes: 0, afterMinutes: 0 },
  exceptions: CalendarEvent[] = [],
): void {
  validateCalendarGeometry(event);
  if (
    (role !== "Routine" || event.start?.date !== undefined) &&
    event.transparency === "transparent"
  ) {
    plan.coverage = "not-required";
    plan.reason = "milestone";
    plan.warningCoverage = "not-enumerated";
    return;
  }
  if (role === "Routine") {
    plan.coverage = "not-required";
    plan.reason = "routine";
    const interval = calendarGeometry(event, zone);
    plan.occupants.push({
      key,
      role,
      originalStart: interval.start,
      interval: buffered(interval, buffer),
    });
    plan.warningCoverage =
      event.recurrence === undefined ? "complete-finite" : "anchor-only";
    return;
  }
  const expanded = expandCalendarEvent(event, zone);
  const byOriginal = new Map(
    exceptions.map((exception) => [
      originalCalendarStart(exception),
      exception,
    ]),
  );
  for (const occurrence of expanded.occurrences) {
    const exception = byOriginal.get(occurrence.originalStart);
    if (
      exception?.status === "cancelled" ||
      exception?.transparency === "transparent"
    )
      continue;
    const interval =
      exception === undefined
        ? occurrence.interval
        : calendarGeometry(exception, zone);
    plan.occupants.push({
      key,
      role,
      originalStart: occurrence.originalStart,
      interval: buffered(interval, buffer),
    });
  }
  for (const exception of exceptions)
    if (
      !expanded.positions.some(({ originalStart }) =>
        sameOriginal(originalStart, originalCalendarStart(exception)),
      )
    )
      unsupported(
        "stored exception lies outside the supported base recurrence",
      );
}

function addOriginal(plan: Plan, ref: EventRef, event: CalendarEvent): void {
  if (!plan.initial.some((state) => refKey(state.ref) === refKey(ref)))
    plan.initial.push({ ref, event, version: calendarStateDigest(event) });
}
export function originalEvent(
  originals: Original[],
  calendarId: string,
  eventId: string,
): CalendarEvent {
  const event = originals.find(
    ({ ref }) => ref.calendarId === calendarId && ref.eventId === eventId,
  )?.event;
  if (event === undefined) unsupported("reviewed source snapshot is missing");
  return event;
}
function sameSchedule(
  left: CalendarEvent,
  right: CalendarEvent,
  zone?: string,
): boolean {
  const l = calendarGeometry(left, left.start?.timeZone ?? zone);
  const r = calendarGeometry(right, right.start?.timeZone ?? zone);
  return isDeepStrictEqual(l, r);
}
export function sameGeometry(
  left: CalendarEvent,
  right: CalendarEvent,
): boolean {
  return isDeepStrictEqual(
    {
      start: left.start,
      end: left.end,
      recurrence: sortedRecurrence(left.recurrence),
    },
    {
      start: right.start,
      end: right.end,
      recurrence: sortedRecurrence(right.recurrence),
    },
  );
}
function endAtOriginal(
  master: CalendarEvent,
  point: CalendarEvent["start"],
  zone?: string,
): CalendarEvent["end"] {
  const geometry = calendarGeometry(master, zone);
  const duration = Date.parse(geometry.end) - Date.parse(geometry.start);
  return point?.dateTime !== undefined
    ? {
        dateTime: new Date(Date.parse(point.dateTime) + duration).toISOString(),
        ...(master.end?.timeZone === undefined
          ? {}
          : { timeZone: master.end.timeZone }),
      }
    : point?.date !== undefined
      ? {
          date: new Date(Date.parse(point.date) + duration)
            .toISOString()
            .slice(0, 10),
        }
      : undefined;
}
function eventAtOccurrence(
  master: CalendarEvent,
  occurrence: CalendarOccurrence,
): CalendarEvent {
  const event = { ...master };
  delete event.recurrence;
  return {
    ...event,
    start:
      master.start?.date === undefined
        ? {
            dateTime: occurrence.interval.start,
            ...(master.start?.timeZone === undefined
              ? {}
              : { timeZone: master.start.timeZone }),
          }
        : { date: occurrence.originalStart },
    end:
      master.end?.date === undefined
        ? {
            dateTime: occurrence.interval.end,
            ...(master.end?.timeZone === undefined
              ? {}
              : { timeZone: master.end.timeZone }),
          }
        : {
            date: new Date(
              Date.parse(occurrence.originalStart) +
                Date.parse(occurrence.interval.end) -
                Date.parse(occurrence.interval.start),
            )
              .toISOString()
              .slice(0, 10),
          },
  };
}
function exceptionPatch(event: CalendarEvent): CalendarEvent {
  const value = restorableEvent(event, "unused");
  if (event.extendedProperties === undefined) delete value.extendedProperties;
  else value.extendedProperties = event.extendedProperties;
  delete value.recurrence;
  return value;
}
function buffered(
  interval: CalendarInterval,
  buffer: { beforeMinutes: number; afterMinutes: number },
): CalendarInterval {
  if (
    ![buffer.beforeMinutes, buffer.afterMinutes].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    unsupported("invalid travel buffer");
  return {
    start: new Date(
      Date.parse(interval.start) - buffer.beforeMinutes * 60_000,
    ).toISOString(),
    end: new Date(
      Date.parse(interval.end) + buffer.afterMinutes * 60_000,
    ).toISOString(),
  };
}
export function sameOriginal(left: string, right: string): boolean {
  return left === right || Date.parse(left) === Date.parse(right);
}
export function atOrAfter(event: CalendarEvent, boundary: string): boolean {
  return Date.parse(originalCalendarStart(event)) >= Date.parse(boundary);
}
export function refKey(ref: Ref): string {
  return JSON.stringify(ref);
}
export function unsupported(reason: string): never {
  throw new OperationalError(
    "invalid-target",
    `Calendar coverage unsupported: ${reason}.`,
  );
}
