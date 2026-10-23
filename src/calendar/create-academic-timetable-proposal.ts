import { OperationalError } from "../operational-error.js";
import { calendarEventIdFor } from "./calendar-idempotency.js";
import { saveAssessedCalendarProposal } from "./save-assessed-calendar-proposal.js";
import { calendarTimetableMapVersion } from "./calendar-occupancy.js";
import { calendarStateDigest } from "./calendar-state-digest.js";
import type {
  CalendarBulkCreateItem,
  CalendarBulkCreateProposalCandidate,
  CalendarProposeReport,
  CalendarProposalReader,
  CalendarProposalStore,
  OwnedCalendarMirrorStore,
  OwnedCalendarWorkspace,
} from "./types.js";
import type { ParsedCalendarAcademicTimetableProposalInput } from "./calendar-proposal-input.js";
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
    timetableRecipe: input.value.recipe,
    timetableMapVersion: calendarTimetableMapVersion(),
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
      digest: "",
      intervals: [],
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

function validateReminders(
  value: Array<{ method: string; minutes: number }> | undefined,
): Array<{ method: string; minutes: number }> {
  return (value ?? []).map(({ method, minutes }) => ({ method, minutes }));
}
