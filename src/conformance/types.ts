export type InventoryEntryKind = "directory" | "file" | "symlink" | "other";

export type MetadataEvidence<T> =
  | { availability: "observed"; value: T }
  | { availability: "unavailable"; reason: string }
  | { availability: "not-applicable" };

export interface InventoryProviderMetadata {
  itemId: MetadataEvidence<string>;
  parentIds: MetadataEvidence<string[]>;
  checksum: MetadataEvidence<{ algorithm: "md5"; value: string }>;
  shortcutTarget: MetadataEvidence<{
    itemId: string;
    mimeType: MetadataEvidence<string>;
  }>;
  trashed: MetadataEvidence<boolean>;
  modifiedAt: MetadataEvidence<string>;
  size: MetadataEvidence<number>;
}

export type InventoryDiagnosticKind =
  | "duplicate-visible-name"
  | "pagination-failure"
  | "rate-limit"
  | "shortcut-cycle"
  | "unavailable-metadata";

export interface InventoryDiagnostic {
  kind: InventoryDiagnosticKind;
  severity: "warning" | "error";
  evidence: string;
}

export interface InventoryProvenance {
  source: "mounted" | "drive-api" | "synthetic";
  target: string;
  completeness: "complete" | "partial";
  diagnostics: InventoryDiagnostic[];
  excludedTrashedItems: number;
}

export interface InventoryEntry {
  path: string;
  kind: InventoryEntryKind;
  size?: number;
  modifiedAt?: string;
  providerMetadata?: InventoryProviderMetadata;
}

export interface Inventory {
  moduleCode: string;
  entries: InventoryEntry[];
  excludedEntries?: InventoryEntry[];
  provenance?: InventoryProvenance;
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
