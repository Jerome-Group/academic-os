export { auditModule } from "./audit-module.js";
export type { ModuleContract } from "./module-contract.js";
export {
  planModuleConformance,
  type ModuleConformancePlan,
  type ProposedConformanceOperation,
} from "./plan-module-conformance.js";
export { auditContextualStructure } from "./audit-contextual-structure.js";
export { auditLearningWorkspace } from "./audit-learning-workspace.js";
export { validateCurationRegister } from "./validate-curation-register.js";
export { validateSourceMap } from "./validate-source-map.js";
export { validateTaskRegister } from "./validate-task-register.js";
export { validateTextbookRegister } from "./validate-textbook-register.js";
export { auditModuleControls } from "./audit-module-controls.js";
export { auditUniversalStructure } from "./audit-universal-structure.js";
export {
  readDefinitionContractVersion,
  supportedContractVersion,
} from "./validate-definition.js";
export type {
  AuditResult,
  ContractRuleId,
  Finding,
  FindingEnforcement,
  FindingSeverity,
  FindingStatus,
  Inventory,
  InventoryDiagnostic,
  InventoryDiagnosticKind,
  InventoryEntry,
  InventoryEntryKind,
  InventoryProvenance,
  InventoryProviderMetadata,
  MetadataEvidence,
  ModuleControlAuditInput,
  ModuleAuditInput,
  ModuleControls,
} from "./types.js";
