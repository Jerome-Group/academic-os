import { isDeepStrictEqual } from "node:util";
import { sortedRecurrence } from "./calendar-event-helpers.js";
import { originalCalendarStart } from "./calendar-occurrences.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import {
  originalEvent,
  sameGeometry,
  sameOriginal,
  refKey,
  unsupported,
  type EventRef,
  type Ref,
  type Original,
  type SeriesInventory,
  type State,
  type Plan,
} from "./calendar-mutation-plan.js";
import type {
  CalendarEvent,
  CalendarProposalCandidate,
  CalendarProposalReader,
  OwnedCalendarMirror,
} from "./types.js";

export async function observeOriginals(
  proposal: CalendarProposalCandidate,
  reader: CalendarProposalReader,
  mirrors: OwnedCalendarMirror[],
): Promise<Original[]> {
  const refs: EventRef[] = [];
  if (proposal.operation === "routine-migration")
    for (const move of proposal.moves)
      refs.push({
        calendarId: move.sourceItem.calendarId,
        eventId: move.sourceItem.eventId,
      });
  else if (
    proposal.operation === "update" ||
    proposal.operation === "move" ||
    proposal.operation === "cancel"
  ) {
    refs.push({
      calendarId: proposal.sourceItem.calendarId,
      eventId: proposal.sourceItem.eventId,
    });
    const selected = mirroredEvent(mirrors, refs[0]);
    if (
      (proposal.recurrenceScope === "entire-series" ||
        proposal.recurrenceScope === "this-and-future") &&
      selected?.recurringEventId !== undefined
    )
      refs.push({
        calendarId: proposal.sourceItem.calendarId,
        eventId: selected.recurringEventId,
      });
  }
  const originals: Original[] = [];
  for (const ref of refs) {
    const mirror = mirroredEvent(mirrors, ref);
    if (
      mirrors
        .find(({ calendarId }) => calendarId === ref.calendarId)
        ?.items.find(({ event }) => event.id === ref.eventId)?.access !==
      "owned"
    )
      unsupported("invited events are read-only");
    const event =
      reader.readEvent === undefined ? mirror : await reader.readEvent(ref);
    if (
      event === undefined ||
      mirror === undefined ||
      calendarStateDigest(event) !== calendarStateDigest(mirror)
    )
      unsupported(
        "source differs from the fresh Owned mirror; Refresh and re-preview",
      );
    if (event.organizer !== undefined && event.organizer.self !== true)
      unsupported("invited events are read-only");
    originals.push({ ref, event });
  }
  return originals;
}

export async function observeInventories(
  proposal: CalendarProposalCandidate,
  reader: CalendarProposalReader,
  originals: Original[],
): Promise<SeriesInventory[]> {
  const inventories: SeriesInventory[] = [];
  const changes =
    proposal.operation === "routine-migration"
      ? proposal.moves
      : proposal.operation === "update" ||
          proposal.operation === "move" ||
          proposal.operation === "cancel"
        ? [proposal]
        : [];
  for (const change of changes) {
    const selected = originalEvent(
      originals,
      change.sourceItem.calendarId,
      change.sourceItem.eventId,
    );
    const masterId = selected.recurringEventId ?? selected.id;
    const master = originals.find(
      ({ ref }) =>
        ref.calendarId === change.sourceItem.calendarId &&
        ref.eventId === masterId,
    )?.event;
    const projected =
      "patch" in change
        ? { ...(master ?? selected), ...change.patch }
        : (master ?? selected);
    const temporal =
      "patch" in change &&
      (!sameGeometry(master ?? selected, projected) ||
        (projected.transparency !== "transparent" &&
          change.target.calendarRole !== "Routine" &&
          ((master ?? selected).transparency === "transparent" ||
            change.sourceItem.calendarRole === "Routine")));
    if (
      change.recurrenceScope !== "this-and-future" &&
      !(
        change.recurrenceScope === "entire-series" &&
        (temporal ||
          proposal.operation === "routine-migration" ||
          proposal.operation === "move")
      )
    )
      continue;
    if (reader.listStoredEvents === undefined)
      unsupported(
        "provider cannot establish complete stored source-series inventory",
      );
    const ref = { calendarId: change.sourceItem.calendarId, eventId: masterId };
    const events = (
      await reader.listStoredEvents({ calendarId: ref.calendarId })
    )
      .filter(
        (event) => event.id === masterId || event.recurringEventId === masterId,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!events.some(({ id }) => id === masterId))
      unsupported("complete source inventory is missing its recurring master");
    const anchors = events
      .filter(({ id }) => id !== masterId)
      .map(originalCalendarStart);
    if (new Set(anchors).size !== anchors.length)
      unsupported("source inventory repeats an original occurrence identity");
    inventories.push({ ref, events });
    for (const event of events)
      if (
        !originals.some(
          (original) =>
            refKey(original.ref) ===
            refKey({ calendarId: ref.calendarId, eventId: event.id }),
        )
      )
        originals.push({
          ref: { calendarId: ref.calendarId, eventId: event.id },
          event,
        });
  }
  return inventories;
}

export async function observeProgress(
  plan: Plan,
  inventories: SeriesInventory[],
  reader: CalendarProposalReader,
  mirrors: OwnedCalendarMirror[],
): Promise<
  | {
      accepted: number;
      acceptedStates: State[];
      resolvedIds: Map<string, string>;
    }
  | undefined
> {
  const states = new Map(
    plan.initial.map((state) => [refKey(state.ref), state]),
  );
  const actual = new Map<string, CalendarEvent | null>();
  const resolvedIds = new Map<string, string>();
  for (const state of plan.initial) {
    const event = await readRef(state.ref, reader, mirrors);
    actual.set(refKey(state.ref), event);
    if (event !== null) resolvedIds.set(refKey(state.ref), event.id);
  }
  const seriesRefs = new Map(inventories.map(({ ref }) => [refKey(ref), ref]));
  for (const step of plan.steps) {
    if (step.kind === "create" && step.event.recurrence !== undefined)
      seriesRefs.set(refKey(step.ref), step.ref);
    if (
      step.kind === "move" &&
      plan.initial.some(
        (state) =>
          refKey(state.ref) === refKey(step.ref) &&
          state.event?.recurrence !== undefined,
      )
    ) {
      const ref = {
        calendarId: step.targetCalendarId,
        eventId: step.ref.eventId,
      };
      seriesRefs.set(refKey(ref), ref);
    }
  }
  const storedByCalendar = new Map<string, CalendarEvent[]>();
  const inventoriesNow = new Map<string, CalendarEvent[]>();
  for (const ref of seriesRefs.values()) {
    if (reader.listStoredEvents === undefined) {
      if (actual.get(refKey(ref)) !== null && actual.has(refKey(ref)))
        return undefined;
      continue;
    }
    let events = storedByCalendar.get(ref.calendarId);
    if (events === undefined) {
      events = await reader.listStoredEvents({ calendarId: ref.calendarId });
      storedByCalendar.set(ref.calendarId, events);
    }
    inventoriesNow.set(
      refKey(ref),
      events.filter(
        (event) =>
          event.id === ref.eventId || event.recurringEventId === ref.eventId,
      ),
    );
  }
  let accepted:
    | {
        accepted: number;
        acceptedStates: State[];
        resolvedIds: Map<string, string>;
      }
    | undefined;
  for (let index = 0; index <= plan.steps.length; index += 1) {
    if (
      [...states.values()].every((state) =>
        stateMatches(actual.get(refKey(state.ref)) ?? null, state),
      ) &&
      [...seriesRefs.values()].every((ref) =>
        (inventoriesNow.get(refKey(ref)) ?? []).every((event) => {
          const expected =
            states.get(
              refKey({ calendarId: ref.calendarId, eventId: event.id }),
            ) ??
            [...states.values()].find(
              (state) =>
                "seriesId" in state.ref &&
                state.ref.calendarId === ref.calendarId &&
                state.ref.seriesId === event.recurringEventId &&
                resolvedIds.get(refKey(state.ref)) === event.id &&
                sameOriginal(
                  state.ref.originalStart,
                  originalCalendarStart(event),
                ),
            );
          return expected !== undefined && stateMatches(event, expected);
        }),
      )
    )
      accepted = {
        accepted: index,
        acceptedStates: [...states.values()],
        resolvedIds,
      };
    const step = plan.steps[index];
    if (step !== undefined)
      for (const change of step.changes) states.set(refKey(change.ref), change);
  }
  return accepted;
}

async function readRef(
  ref: Ref,
  reader: CalendarProposalReader,
  mirrors: OwnedCalendarMirror[],
): Promise<CalendarEvent | null> {
  if ("seriesId" in ref) {
    if (
      reader.readEvent === undefined &&
      mirroredEvent(mirrors, {
        calendarId: ref.calendarId,
        eventId: ref.seriesId,
      }) === undefined
    )
      return null;
    if (reader.readEvent !== undefined) {
      try {
        const master = await reader.readEvent({
          calendarId: ref.calendarId,
          eventId: ref.seriesId,
        });
        if (master.status === "cancelled") return null;
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    }
    if (reader.listSeriesInstances === undefined)
      unsupported("provider cannot resolve an exact replacement exception");
    const events = await reader.listSeriesInstances({
      calendarId: ref.calendarId,
      eventId: ref.seriesId,
      originalStart: ref.originalStart,
    });
    if (
      events.length > 1 ||
      events.some(
        (event) =>
          event.recurringEventId !== ref.seriesId ||
          !sameOriginal(originalCalendarStart(event), ref.originalStart),
      )
    )
      unsupported("provider returned an ambiguous exception identity");
    return events[0] ?? null;
  }
  if (reader.readEvent === undefined)
    return mirroredEvent(mirrors, ref) ?? null;
  try {
    return await reader.readEvent(ref);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function stateMatches(actual: CalendarEvent | null, state: State): boolean {
  if (
    actual !== null &&
    "eventId" in state.ref &&
    actual.id !== state.ref.eventId
  )
    return false;
  if (state.event === null)
    return (
      actual === null ||
      actual.status === "cancelled" ||
      (state.allowOriginal !== undefined &&
        (actual.organizer === undefined || actual.organizer.self === true) &&
        sameInstanceIdentity(actual, state.allowOriginal, state) &&
        calendarContentMatches(actual, state.allowOriginal))
    );
  if (
    actual === null ||
    (actual.organizer !== undefined && actual.organizer.self !== true) ||
    !sameInstanceIdentity(actual, state.event, state) ||
    !calendarContentMatches(actual, state.event)
  )
    return false;
  return (
    state.version === undefined || calendarStateDigest(actual) === state.version
  );
}

function sameInstanceIdentity(
  actual: CalendarEvent,
  expected: CalendarEvent,
  state: State,
): boolean {
  if (!("eventId" in state.ref)) return true;
  return (
    actual.recurringEventId === expected.recurringEventId &&
    (expected.originalStartTime === undefined
      ? actual.originalStartTime === undefined
      : actual.originalStartTime !== undefined &&
        sameOriginal(
          originalCalendarStart(actual),
          originalCalendarStart(expected),
        ))
  );
}

export function calendarContentMatches(
  actual: CalendarEvent,
  expected: CalendarEvent,
): boolean {
  return isDeepStrictEqual(
    normalizedContent(actual, expected),
    normalizedContent(expected, expected),
  );
}

function normalizedContent(
  event: CalendarEvent,
  expected: CalendarEvent,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...event };
  for (const key of [
    "id",
    "etag",
    "created",
    "updated",
    "creator",
    "organizer",
    "htmlLink",
    "iCalUID",
    "kind",
    "hangoutLink",
    "locked",
    "sequence",
    "recurringEventId",
    "originalStartTime",
  ])
    delete result[key];
  if (result.status === "confirmed" || result.status === undefined)
    delete result.status;
  result.transparency = result.transparency ?? "opaque";
  if (result.visibility === undefined || result.visibility === "default")
    delete result.visibility;
  if (
    expected.reminders === undefined &&
    isRecord(result.reminders) &&
    result.reminders.useDefault === true &&
    Object.keys(result.reminders).length === 1
  )
    delete result.reminders;
  if (result.recurrence !== undefined)
    result.recurrence = sortedRecurrence(result.recurrence);
  for (const key of ["start", "end"] as const) {
    const point = event[key];
    const expectedPoint = expected[key];
    if (point?.dateTime !== undefined)
      result[key] = {
        dateTime: new Date(Date.parse(point.dateTime)).toISOString(),
        ...(expectedPoint?.timeZone === undefined
          ? {}
          : { timeZone: point.timeZone ?? expectedPoint.timeZone }),
      };
  }
  return result;
}

function mirroredEvent(
  mirrors: OwnedCalendarMirror[],
  ref: EventRef | undefined,
): CalendarEvent | undefined {
  return mirrors
    .find(({ calendarId }) => calendarId === ref?.calendarId)
    ?.items.find(({ event }) => event.id === ref?.eventId)?.event;
}
function missing(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.code === 404 ||
      (isRecord(error.response) && error.response.status === 404))
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
