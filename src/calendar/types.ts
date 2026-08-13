export type OwnedCalendarRole = "Academic" | "Commitments" | "Routine";

export const OWNED_CALENDAR_ROLES: readonly OwnedCalendarRole[] = [
  "Academic",
  "Commitments",
  "Routine",
];

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

export interface OwnedCalendarWorkspaceReader {
  read(): Promise<OwnedCalendarWorkspace>;
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

export interface CalendarEvent {
  id: string;
  summary?: string;
  organizer?: {
    email?: string;
    self?: boolean;
  };
  recurrence?: string[];
  recurringEventId?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  transparency?: string;
  [key: string]: unknown;
}

export interface CalendarRefreshReader {
  listForwardEvents(input: {
    calendarId: string;
    managementHorizon: string;
  }): Promise<CalendarEvent[]>;
}

export interface MirroredCalendarItem {
  actualCalendarRole: OwnedCalendarRole;
  access: "owned" | "invited-read-only";
  event: CalendarEvent;
}

export interface OwnedCalendarMirror {
  schemaVersion: 1;
  role: OwnedCalendarRole;
  calendarId: string;
  managementHorizon: string;
  refreshedAt: string;
  freshness: "fresh";
  items: MirroredCalendarItem[];
}

export interface OwnedCalendarMirrorStore {
  write(mirror: OwnedCalendarMirror): Promise<void>;
}

export interface PlacementSuggestion {
  eventId: string;
  summary: string;
  actualRole: OwnedCalendarRole;
  suggestedRole: OwnedCalendarRole;
  reason: "transparent-recurring";
}

export interface CalendarRefreshReport {
  schemaVersion: 1;
  command: "calendar refresh";
  outcome: "refreshed";
  managementHorizon: string;
  calendars: Array<{
    role: OwnedCalendarRole;
    refreshedAt: string;
    freshness: "fresh";
    counts: {
      items: number;
      recurringMasters: number;
      exceptions: number;
      invited: number;
    };
  }>;
  placementSuggestions: PlacementSuggestion[];
}
