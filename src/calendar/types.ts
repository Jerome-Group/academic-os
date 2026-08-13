export type OwnedCalendarRole = "Academic" | "Commitments" | "Routine";

export interface CalendarListEntry {
  id: string;
  primary?: boolean;
  summary: string;
}

export interface CalendarSetupReader {
  listCalendars(): Promise<CalendarListEntry[]>;
}

export interface CalendarSetupWriter {
  createCalendar(
    summary: Exclude<OwnedCalendarRole, "Academic">,
  ): Promise<{ id: string }>;
}

export interface OwnedCalendarWorkspaceStore {
  write(workspace: OwnedCalendarWorkspace): Promise<void>;
}

export interface OwnedCalendarWorkspace {
  schemaVersion: 1;
  defaultTimezone: "Asia/Singapore";
  managementHorizon: string;
  ownedCalendarIds: Record<OwnedCalendarRole, string>;
}

export interface CalendarSetupReport {
  schemaVersion: 1;
  command: "calendar setup";
  outcome: "configured" | "preview";
  defaultTimezone: "Asia/Singapore";
  managementHorizon: string;
  calendars: Array<{
    role: OwnedCalendarRole;
    action: "bound" | "reused" | "would-create" | "created";
    source: "primary" | "named" | "new";
  }>;
  workspace: "written" | "not-written";
}
