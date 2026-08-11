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

export type FindingStatus =
  | "pass"
  | "fail"
  | "warning"
  | "manual-review"
  | "requires-decision"
  | "not-applicable";

export type FindingSeverity = "information" | "warning" | "error" | "decision";

export interface Finding {
  ruleId: string;
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
