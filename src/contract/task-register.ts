// The Task-register vocabulary MF-TASKS-001 fixes, read by the store the CLI writes through and by
// the auditor that validates a module's file — so where the register lives, which statuses it may
// hold, and which provenance keys Google never sees are spelled once for both.
export const taskRegisterPath = "00 Module Admin/30 Task Register.yaml";

export const taskStatuses = ["open", "completed", "cancelled"] as const;

export const taskProvenanceKeys = [
  "assessment",
  "source",
  "milestone",
] as const;
