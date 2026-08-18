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

export type ResolvedTasksConfig = TasksConfig;

export interface AcademicConfig {
  driveMount: string;
  stateRoot: string;
  activeSemester: string;
  semesters: Record<string, SemesterConfig>;
  seedTarget?: ConfiguredModule;
  calendar?: CalendarConfig;
  tasks?: TasksConfig;
  driveApi?: {
    moduleFolderIds: Record<string, Record<string, string>>;
  };
  repair?: {
    driveRecoveryRootId: string;
    snapshotRoot: string;
  };
}
