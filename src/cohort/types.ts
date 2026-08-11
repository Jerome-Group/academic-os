import type { ConfiguredModule } from "../config/index.js";
import type { JsonAuditReport } from "../report/index.js";

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
