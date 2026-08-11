export type InventoryEntryKind = "directory" | "file" | "symlink" | "other";

export interface InventoryEntry {
  path: string;
  kind: InventoryEntryKind;
  size?: number;
  modifiedAt: string;
}

export interface Inventory {
  moduleCode: string;
  entries: InventoryEntry[];
}

export interface ModuleControls {
  profile?: string;
  definition?: string;
  curationRegister?: string;
  agents?: string;
  claude?: string;
  context?: string;
}

export interface ModuleControlAuditInput {
  moduleCode: string;
  semester: string;
  controls: ModuleControls;
}

export interface ModuleAuditInput extends ModuleControlAuditInput {
  inventory: Inventory;
}

export type FindingStatus =
  | "pass"
  | "fail"
  | "warning"
  | "manual-review"
  | "requires-decision"
  | "not-applicable";

import type { ContractRuleId, FindingEnforcement } from "./rule-enforcement.js";

export type { ContractRuleId, FindingEnforcement } from "./rule-enforcement.js";

export type FindingSeverity = "information" | "warning" | "error" | "decision";

export interface Finding {
  ruleId: ContractRuleId;
  enforcement: FindingEnforcement;
  status: FindingStatus;
  severity: FindingSeverity;
  path: string;
  evidence: string;
  explanation: string;
  applicability: string;
}

export interface AuditResult {
  outcome: "conformant" | "deviation" | "requires-decision";
  findings: Finding[];
}
