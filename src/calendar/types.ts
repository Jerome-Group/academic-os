export type OwnedCalendarRole = "Academic" | "Commitments" | "Routine";

export const OWNED_CALENDAR_ROLES: readonly OwnedCalendarRole[] = [
  "Academic",
  "Commitments",
  "Routine",
];

export interface CalendarListEntry {
  accessRole?: string;
  colorId?: string;
  defaultReminders?: Array<{
    method: string;
    minutes: number;
  }>;
  etag?: string;
  hidden?: boolean;
  id: string;
  primary?: boolean;
  selected?: boolean;
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
  listEventChanges(input: {
    calendarId: string;
    managementHorizon: string;
    syncToken?: string;
  }): Promise<{
    events: CalendarEvent[];
    nextSyncToken: string;
  }>;
}

export interface CalendarProposalReader {
  listCalendars(): Promise<CalendarListEntry[]>;
  listEventOccurrences(input: {
    calendarId: string;
    timeMin: string;
    timeMax: string;
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
  lastSuccessfulRefresh: string | null;
  freshness: "fresh" | "stale";
  syncToken?: string;
  items: MirroredCalendarItem[];
  tombstones: CalendarTombstone[];
}

export interface OwnedCalendarMirrorStore {
  read(role: OwnedCalendarRole): Promise<OwnedCalendarMirror | undefined>;
  write(mirror: OwnedCalendarMirror): Promise<void>;
}

export interface CalendarTombstone {
  deletedAt: string;
  event: CalendarEvent;
}

export interface CalendarProposalStore {
  markPromoted(proposalId: string): Promise<void>;
  markStale(
    proposalId: string,
    reason: CalendarProposalStaleReason,
  ): Promise<void>;
  read(proposalId: string): Promise<CalendarProposal | undefined>;
  markStaleForDeletedItems(
    deletedItems: Array<{
      calendarRole: OwnedCalendarRole;
      eventId: string;
    }>,
  ): Promise<void>;
  writeCurrent(proposal: CalendarProposal): Promise<void>;
}

export type CalendarProposalStaleReason =
  | "live-item-deleted"
  | "live-version-changed";

export interface CalendarPromotionWriter {
  createEvent(input: {
    calendarId: string;
    eventId: string;
    event: CalendarIntendedEvent;
    idempotencyKey: string;
  }): Promise<void>;
  readEvent(input: {
    calendarId: string;
    eventId: string;
  }): Promise<CalendarEvent>;
}

export interface CalendarPromotionReport {
  schemaVersion: 1;
  command: "calendar promote";
  outcome: "promoted" | "retry" | "stale" | "blocked";
  proposalId: string;
  verifiedEvent?: CalendarEvent;
}

export interface CalendarPromotionRecord {
  schemaVersion: 1;
  proposalId: string;
  eventId: string;
  idempotencyKey: string;
}

export interface CalendarPromotionJournal {
  find(proposalId: string): Promise<CalendarPromotionRecord | undefined>;
  appendOnce(record: CalendarPromotionRecord): Promise<boolean>;
}

export interface CalendarProposalSource {
  kind: string;
  reference: string;
}

export type CalendarProposalItemKind =
  | "fixed-event"
  | "routine-event"
  | "timed-milestone"
  | "all-day-milestone";

export interface CalendarInterval {
  start: string;
  end: string;
}

export interface CalendarIntendedEvent {
  summary: string;
  visibility: "private";
  transparency: "opaque" | "transparent";
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
}

export interface CalendarProposalLiveVersion {
  kind: "owned-mirror";
  calendarRole: OwnedCalendarRole;
  calendarId: string;
  syncToken: string;
  lastSuccessfulRefresh: string;
}

export interface CalendarProposalCandidate {
  id: string;
  status?: "ready";
  operation: "create";
  source: CalendarProposalSource;
  itemKind: CalendarProposalItemKind;
  target: {
    calendarRole: OwnedCalendarRole;
    calendarId: string;
  };
  intendedEvent: CalendarIntendedEvent;
  inheritedDefaults: {
    calendarColorId: string | null;
    reminders: Array<{ method: string; minutes: number }>;
  };
  targetCalendarVersion: {
    calendarId: string;
    etag: string;
  };
  idempotencyKey: string;
  liveVersions: CalendarProposalLiveVersion[];
  relevantAvailabilityVersion: {
    digest: string;
    interval: CalendarInterval | null;
    checkedCalendarCount: number;
  };
  conflictSummary: {
    blockers: number;
    warnings: number;
  };
}

export interface CalendarProposal extends CalendarProposalCandidate {
  status: "ready";
}

export interface CalendarOverlap {
  severity: "block" | "warning";
  source: "Owned" | "Observed";
  calendarRole?: OwnedCalendarRole;
  eventId: string;
  summary: string;
  start: string;
  end: string;
}

export interface CalendarProposeReport {
  schemaVersion: 1;
  command: "calendar propose";
  outcome: "ready" | "blocked";
  proposal: CalendarProposalCandidate;
  conflicts: CalendarOverlap[];
  warnings: CalendarOverlap[];
  workspace: "written" | "not-written";
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
  outcome: "refreshed" | "partially-refreshed" | "stale";
  managementHorizon: string;
  calendars: Array<{
    role: OwnedCalendarRole;
    lastSuccessfulRefresh: string | null;
    freshness: "fresh" | "stale";
    counts: {
      items: number;
      recurringMasters: number;
      exceptions: number;
      invited: number;
    };
  }>;
  placementSuggestions: PlacementSuggestion[];
}
