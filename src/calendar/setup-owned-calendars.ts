import { OperationalError } from "../mounted/index.js";
import type {
  CalendarSetupReader,
  CalendarSetupReport,
  CalendarSetupWriter,
  OwnedCalendarRole,
  OwnedCalendarWorkspace,
  OwnedCalendarWorkspaceStore,
} from "./types.js";

export const DEFAULT_CALENDAR_TIMEZONE = "Asia/Singapore";

export async function setupOwnedCalendars(input: {
  managementHorizon: string;
  reader: CalendarSetupReader;
  writer: CalendarSetupWriter;
  workspaceStore: OwnedCalendarWorkspaceStore;
  apply: boolean;
}): Promise<CalendarSetupReport> {
  const calendars = await input.reader.listCalendars();
  const primary = calendars.filter(({ primary }) => primary === true);
  if (primary.length !== 1) {
    throw new OperationalError(
      "ambiguous-target",
      `Calendar setup requires exactly one primary calendar; found ${primary.length}.`,
    );
  }
  const ids = {
    Academic: requireCalendarId(primary[0], "primary"),
    Commitments: exactNamedCalendarId(calendars, "Commitments"),
    Routine: exactNamedCalendarId(calendars, "Routine"),
  };
  const missing = (["Commitments", "Routine"] as const).filter(
    (role) => ids[role] === undefined,
  );
  if (missing.length > 0 && !input.apply) {
    return createSetupReport({
      ids,
      managementHorizon: input.managementHorizon,
      outcome: "preview",
      workspace: "not-written",
    });
  }
  const created = new Set<"Commitments" | "Routine">();
  for (const role of missing) {
    const calendar = await input.writer.createCalendar(role);
    ids[role] = calendar.id;
    created.add(role);
  }
  const workspace: OwnedCalendarWorkspace = {
    schemaVersion: 1,
    defaultTimezone: DEFAULT_CALENDAR_TIMEZONE,
    managementHorizon: input.managementHorizon,
    ownedCalendarIds: completeOwnedCalendarIds(ids),
  };
  await input.workspaceStore.write(workspace);
  return createSetupReport({
    ids,
    created,
    managementHorizon: input.managementHorizon,
    outcome: "configured",
    workspace: "written",
  });
}

function createSetupReport(input: {
  ids: {
    Academic: string;
    Commitments: string | undefined;
    Routine: string | undefined;
  };
  managementHorizon: string;
  outcome: "configured" | "preview";
  workspace: "written" | "not-written";
  created?: ReadonlySet<"Commitments" | "Routine">;
}): CalendarSetupReport {
  return {
    schemaVersion: 1,
    command: "calendar setup",
    outcome: input.outcome,
    defaultTimezone: DEFAULT_CALENDAR_TIMEZONE,
    managementHorizon: input.managementHorizon,
    calendars: [
      { role: "Academic", action: "bound", source: "primary" },
      setupSecondaryOutcome(
        "Commitments",
        input.ids.Commitments,
        input.created?.has("Commitments") ?? false,
      ),
      setupSecondaryOutcome(
        "Routine",
        input.ids.Routine,
        input.created?.has("Routine") ?? false,
      ),
    ],
    workspace: input.workspace,
  };
}

function setupSecondaryOutcome(
  role: "Commitments" | "Routine",
  id: string | undefined,
  created: boolean,
): CalendarSetupReport["calendars"][number] {
  if (id === undefined) return { role, action: "would-create", source: "new" };
  return created
    ? { role, action: "created", source: "new" }
    : { role, action: "reused", source: "named" };
}

function exactNamedCalendarId(
  calendars: Awaited<ReturnType<CalendarSetupReader["listCalendars"]>>,
  summary: "Commitments" | "Routine",
): string | undefined {
  const matches = calendars.filter(
    (calendar) => calendar.primary !== true && calendar.summary === summary,
  );
  if (matches.length > 1) {
    throw new OperationalError(
      "ambiguous-target",
      `Calendar setup found ${matches.length} calendars named ${summary}.`,
    );
  }
  return matches[0] === undefined
    ? undefined
    : requireCalendarId(matches[0], summary);
}

function requireCalendarId(
  calendar: { id?: string } | undefined,
  role: string,
): string {
  if (typeof calendar?.id !== "string" || calendar.id === "") {
    throw new OperationalError(
      "invalid-target",
      `Calendar setup found no provider ID for ${role}.`,
    );
  }
  return calendar.id;
}

function completeOwnedCalendarIds(ids: {
  Academic: string;
  Commitments: string | undefined;
  Routine: string | undefined;
}): Record<OwnedCalendarRole, string> {
  return {
    Academic: ids.Academic,
    Commitments: requireCalendarId(
      ids.Commitments === undefined ? undefined : { id: ids.Commitments },
      "Commitments",
    ),
    Routine: requireCalendarId(
      ids.Routine === undefined ? undefined : { id: ids.Routine },
      "Routine",
    ),
  };
}
