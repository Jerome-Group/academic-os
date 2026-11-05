import type {
  CalendarConfig,
  ResearchProjectConfig,
  SemesterConfig,
} from "./generated/configuration-1.js";
export type {
  AcademicConfig,
  CalendarConfig,
  ConfiguredModule,
  LoadedConfig,
  LocalConfig,
  ResearchConfig,
  ResearchProjectConfig,
  RoutineConfig,
  SemesterConfig,
  ServiceConfig,
  TaskPlanningConfig,
  TasksConfig,
  TextbooksConfig,
} from "./generated/configuration-1.js";

export type SemesterStatus = SemesterConfig["status"];
export type ResearchProjectStatus = ResearchProjectConfig["status"];
export type ResearchProjectProfile = NonNullable<
  ResearchProjectConfig["profile"]
>;
export interface ConfiguredResearchProject {
  key: string;
}
export interface ResolvedResearchProject
  extends ResearchProjectConfig,
    ConfiguredResearchProject {
  root: string;
}
export interface ResolvedCalendarConfig extends CalendarConfig {
  stateRoot: string;
}
