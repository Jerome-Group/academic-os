import type { ConfiguredModule } from "../config/index.js";
import type {
  JsonAuditReport,
  ResearchProjectAuditReport,
} from "../report/index.js";

export interface ExcludedModule extends ConfiguredModule {
  reason: "past" | "future";
}

export interface UnresolvedModule extends ConfiguredModule {
  reason: string;
}

export interface CohortSelection {
  included: ConfiguredModule[];
  excluded: ExcludedModule[];
  unresolved: UnresolvedModule[];
}

export interface CohortAuditReport {
  schemaVersion: 1;
  mode: "cohort";
  activeSemester: string;
  outcome:
    | "conformant"
    | "deviation"
    | "requires-decision"
    | "operational-failure";
  selection: CohortSelection;
  modules: Array<JsonAuditReport | ModuleOperationalFailure>;
  researchSelection?: ResearchProjectSelection;
  researchProjects?: Array<
    ResearchProjectAuditReport | ResearchProjectOperationalFailure
  >;
}

export interface ResearchProjectSelectionEntry {
  key: string;
  folder: string;
}

export interface ExcludedResearchProject extends ResearchProjectSelectionEntry {
  reason: "inactive";
}

export interface UnresolvedResearchProject
  extends ResearchProjectSelectionEntry {
  reason: string;
}

export interface ResearchProjectSelection {
  included: ResearchProjectSelectionEntry[];
  excluded: ExcludedResearchProject[];
  unresolved: UnresolvedResearchProject[];
}

export interface ResearchProjectOperationalFailure {
  project: ResearchProjectSelectionEntry;
  outcome: "operational-failure";
  error: {
    code: string;
    message: string;
  };
}

export interface ModuleOperationalFailure {
  module: {
    code: string;
    semester: string;
  };
  outcome: "operational-failure";
  error: {
    code: string;
    message: string;
  };
}
