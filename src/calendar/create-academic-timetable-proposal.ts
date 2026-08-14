import { OperationalError } from "../operational-error.js";
import {
  collectCalendarAvailability,
  findCalendarOverlaps,
} from "./calendar-conflicts.js";
import { calendarEventIdFor } from "./calendar-idempotency.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import type {
  CalendarBulkCreateItem,
  CalendarBulkCreateProposalCandidate,
  CalendarInterval,
  CalendarProposal,
  CalendarProposeReport,
  CalendarProposalReader,
  CalendarProposalStore,
  OwnedCalendarMirrorStore,
  OwnedCalendarWorkspace,
} from "./types.js";
import type {
  ParsedCalendarAcademicTimetableProposalInput,
  ParsedCalendarBulkCreateItem,
} from "./calendar-proposal-input.js";
import { readCurrentCalendarMirrors } from "./read-current-calendar-mirrors.js";

export async function createAcademicTimetableProposal(input: {
  value: ParsedCalendarAcademicTimetableProposalInput;
  workspace: OwnedCalendarWorkspace;
  reader: CalendarProposalReader;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
}): Promise<CalendarProposeReport> {
  const mirrors = await readCurrentCalendarMirrors(
    input.mirrorStore,
    input.workspace,
  );
  const calendars = await input.reader.listCalendars();
  const targetCalendarId = input.workspace.ownedCalendarIds.Academic;
  const targetCalendar = calendars.find(({ id }) => id === targetCalendarId);
  if (targetCalendar === undefined) {
    throw new OperationalError(
      "invalid-target",
      "The Academic calendar is not visible in the current Calendar list.",
    );
  }
  if (typeof targetCalendar.etag !== "string" || targetCalendar.etag === "") {
    throw new OperationalError(
      "operational-failure",
      "Calendar Propose received no live version for Academic.",
    );
  }

  const intervals = input.value.items.flatMap(
    ({ occupiedIntervals }) => occupiedIntervals,
  );
  const availability = await collectCalendarAvailability({
    reader: input.reader,
    calendars,
    mirrors,
    ownedCalendarIds: input.workspace.ownedCalendarIds,
    interval: boundingInterval(intervals),
  });
  const { conflicts, warnings } = collectBulkOverlaps(
    input.value.items,
    availability.items,
  );
  const intentDigest = calendarStateDigest({
    operation: "bulk-create",
    source: input.value.source,
    target: { calendarRole: "Academic", calendarId: targetCalendarId },
    items: input.value.items,
  });
  const idempotencyKey = `bulk-create-${intentDigest}`;
  const items: CalendarBulkCreateItem[] = input.value.items.map((item) => ({
    ...item,
    eventId: calendarEventIdFor(`${idempotencyKey}:${item.key}`),
    idempotencyKey: `${idempotencyKey}:${item.key}`,
  }));
  const proposal: CalendarBulkCreateProposalCandidate = {
    id: `proposal-${intentDigest.slice(0, 24)}`,
    ...(conflicts.length === 0 ? { status: "ready" as const } : {}),
    operation: "bulk-create",
    source: input.value.source,
    itemKind: "fixed-event",
    target: { calendarRole: "Academic", calendarId: targetCalendarId },
    items,
    inheritedDefaults: {
      calendarColorId: targetCalendar.colorId ?? null,
      reminders: validateReminders(targetCalendar.defaultReminders),
    },
    targetCalendarVersion: {
      calendarId: targetCalendarId,
      etag: targetCalendar.etag,
    },
    idempotencyKey,
    liveVersions: mirrors.map((mirror) => ({
      kind: "owned-mirror" as const,
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
      intervals,
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

function collectBulkOverlaps(
  items: ParsedCalendarBulkCreateItem[],
  availability: Parameters<typeof findCalendarOverlaps>[0]["availability"],
) {
  const seen = new Set<string>();
  const overlaps = items.flatMap((item) =>
    item.occupiedIntervals.flatMap((interval) =>
      findCalendarOverlaps({
        availability,
        interval,
        proposedKind: item.itemKind,
      }).filter((overlap) => {
        const key = `${item.key}\0${overlap.eventId}\0${overlap.start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    ),
  );
  return {
    conflicts: overlaps.filter(({ severity }) => severity === "block"),
    warnings: overlaps.filter(({ severity }) => severity === "warning"),
  };
}

function boundingInterval(intervals: CalendarInterval[]): CalendarInterval {
  const first = intervals[0];
  if (first === undefined) {
    throw new OperationalError(
      "invalid-target",
      "An academic timetable Proposal must contain an occupied interval.",
    );
  }
  return intervals.reduce(
    (result, interval) => ({
      start:
        Date.parse(interval.start) < Date.parse(result.start)
          ? interval.start
          : result.start,
      end:
        Date.parse(interval.end) > Date.parse(result.end)
          ? interval.end
          : result.end,
    }),
    first,
  );
}

function validateReminders(
  value: Array<{ method: string; minutes: number }> | undefined,
): Array<{ method: string; minutes: number }> {
  return (value ?? []).map(({ method, minutes }) => ({ method, minutes }));
}
