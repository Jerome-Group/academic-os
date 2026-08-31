// The Task-register vocabulary MF-TASKS-001 fixes, read by the store the CLI writes through and by
// the auditor that validates a module's file — so where the register lives, which statuses it may
// hold, and which provenance keys Google never sees are spelled once for both.
export const taskRegisterPath = "00 Module Admin/30 Task Register.yaml";

export const taskStatuses = ["open", "completed", "cancelled"] as const;

export const moduleTaskProvenanceKeys = [
  "assessment",
  "source",
  "milestone",
] as const;

export const researchTaskProvenanceKeys = [
  ...moduleTaskProvenanceKeys,
  "claim",
  "meeting",
  "deliverable",
] as const;

// Compatibility name for the module contract. Research-project callers must select the explicit
// extended vocabulary rather than broadening MF-TASKS-001 by importing this name.
export const taskProvenanceKeys = moduleTaskProvenanceKeys;
