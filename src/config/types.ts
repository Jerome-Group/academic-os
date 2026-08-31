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

export type ResearchProjectStatus = "active" | "inactive";
export type ResearchProjectProfile = "ureca";

export interface ResearchProjectConfig {
  folder: string;
  status: ResearchProjectStatus;
  profile?: ResearchProjectProfile;
  taskListTitle?: string;
}

export interface ResearchConfig {
  root: string;
  projects: Record<string, ResearchProjectConfig>;
}

export interface ConfiguredResearchProject {
  key: string;
}

export interface ResolvedResearchProject
  extends ResearchProjectConfig,
    ConfiguredResearchProject {
  root: string;
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

// The two command-line tools the morning routine reaches for, named because both install outside
// the minimal PATH a LaunchAgent runs with — the Codex CLI its module sessions run under, and the
// `gh` CLI it raises the morning's issue through.
export interface RoutineConfig {
  codexPath: string;
  ghPath: string;
}

// The Textbook shelf, named relative to the Drive mount as every semester root is.
export interface TextbooksConfig {
  shelfRoot: string;
}

export interface AcademicConfig {
  driveMount: string;
  stateRoot: string;
  activeSemester: string;
  semesters: Record<string, SemesterConfig>;
  research?: ResearchConfig;
  seedTarget?: ConfiguredModule;
  calendar?: CalendarConfig;
  tasks?: TasksConfig;
  textbooks?: TextbooksConfig;
  routine?: RoutineConfig;
  driveApi?: {
    moduleFolderIds: Record<string, Record<string, string>>;
    researchProjectFolderIds?: Record<string, string>;
  };
  repair?: {
    driveRecoveryRootId: string;
    snapshotRoot: string;
  };
}
