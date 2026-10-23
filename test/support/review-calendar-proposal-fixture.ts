import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assessCalendarProposal } from "../../src/calendar/calendar-occupancy.js";
import { parseStoredCalendarProposal } from "../../src/calendar/parse-stored-calendar-proposal.js";
import { createFileOwnedCalendarMirrorStore } from "../../src/calendar/file-owned-calendar-mirror-store.js";
import { createFileOwnedCalendarWorkspaceReader } from "../../src/calendar/file-owned-calendar-workspace-store.js";
import { readCurrentCalendarMirrors } from "../../src/calendar/read-current-calendar-mirrors.js";
import type {
  CalendarEvent,
  CalendarListEntry,
  CalendarProposalReader,
} from "../../src/calendar/types.js";

export async function reviewCalendarProposalFixture(input: {
  calendarRoot: string;
  providerPath: string;
}): Promise<void> {
  const path = join(input.calendarRoot, "pending-proposals.json");
  const state = JSON.parse(await readFile(path, "utf8"));
  const proposal = parseStoredCalendarProposal(state.proposals[0]);
  delete proposal.review;
  const provider: {
    calendars: CalendarListEntry[];
    events: Record<string, CalendarEvent[]>;
  } = JSON.parse(await readFile(input.providerPath, "utf8"));
  const workspace = await createFileOwnedCalendarWorkspaceReader(
    join(input.calendarRoot, ".."),
  ).read();
  const mirrors = await readCurrentCalendarMirrors(
    createFileOwnedCalendarMirrorStore(join(input.calendarRoot, "..")),
    workspace,
  );
  const reader: CalendarProposalReader = {
    listCalendars: async () => provider.calendars,
    readEvent: async ({ calendarId, eventId }) => {
      const event = provider.events[calendarId]?.find(
        ({ id }) => id === eventId,
      );
      if (event === undefined) throw { code: 404 };
      return event;
    },
    listStoredEvents: async ({ calendarId }) =>
      provider.events[calendarId] ?? [],
    listEventOccurrences: async ({ calendarId }) =>
      (provider.events[calendarId] ?? []).filter(
        (event) =>
          event.recurrence === undefined && event.status !== "cancelled",
      ),
  };
  const assessment = await assessCalendarProposal({
    proposal,
    workspace,
    mirrors,
    reader,
  });
  if (assessment.outcome !== "ready")
    throw new Error(
      `Fixture cannot receive a fresh Calendar review: ${assessment.reason}`,
    );
  state.proposals[0] = { ...proposal, review: assessment.review };
  await writeFile(path, JSON.stringify(state));
}
