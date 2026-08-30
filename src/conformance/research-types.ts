import type {
  ResearchContractRuleId,
  ResearchFindingEnforcement,
} from "./research-rule-enforcement.js";
import type {
  FindingStatus,
  InventoryEntry,
  InventoryProvenance,
} from "./types.js";

export type ResearchProjectProfile = "generic" | "ureca";

export interface ResearchProjectInventory {
  projectKey: string;
  entries: InventoryEntry[];
  excludedEntries?: InventoryEntry[];
  provenance?: InventoryProvenance;
}

export interface ResearchFinding {
  ruleId: ResearchContractRuleId;
  enforcement: ResearchFindingEnforcement;
  status: FindingStatus;
  severity: "information" | "warning" | "error" | "decision";
  path: string;
  evidence: string;
  explanation: string;
  applicability: string;
}

export interface ResearchAuditResult {
  outcome: "conformant" | "deviation" | "requires-decision";
  findings: ResearchFinding[];
}
