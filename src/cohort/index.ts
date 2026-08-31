export {
  planCohortAudit,
  resolveConfiguredAuditTarget,
} from "./plan-cohort-audit.js";
export { evaluateResearchProjectAudit } from "./evaluate-research-project-audit.js";
export { runCohortAudit } from "./run-cohort-audit.js";
export type {
  CohortAuditReport,
  CohortSelection,
  ExcludedResearchProject,
  ExcludedModule,
  ModuleOperationalFailure,
  ResearchProjectOperationalFailure,
  ResearchProjectSelection,
  ResearchProjectSelectionEntry,
  UnresolvedModule,
  UnresolvedResearchProject,
} from "./types.js";
