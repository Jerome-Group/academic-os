export type SemesterStatus = "active" | "past" | "future";

export interface SemesterConfig {
  root: string;
  status: SemesterStatus;
  modules: string[];
}

export interface ConfiguredModule {
  semester: string;
  module: string;
}

export interface CalendarConfig {
  managementHorizon: string;
  credentials: {
    scheduledRead: string;
    interactiveWrite: string;
  };
}

export interface ResolvedCalendarConfig extends CalendarConfig {
  stateRoot: string;
}

export interface TasksConfig {
  credentials: {
    scheduledRead: string;
    interactiveWrite: string;
  };
}

// The shelf as the configuration names it: a path relative to the Drive mount.
export interface TextbooksConfig {
  shelfRoot: string;
}

// The shelf as a command uses it: the absolute path that relative one resolved to.
export interface ResolvedTextbooksConfig {
  shelfRoot: string;
}

export interface AcademicConfig {
  driveMount: string;
  stateRoot: string;
  activeSemester: string;
  semesters: Record<string, SemesterConfig>;
  seedTarget?: ConfiguredModule;
  calendar?: CalendarConfig;
  tasks?: TasksConfig;
  textbooks?: TextbooksConfig;
  driveApi?: {
    moduleFolderIds: Record<string, Record<string, string>>;
  };
  repair?: {
    driveRecoveryRootId: string;
    snapshotRoot: string;
  };
}
