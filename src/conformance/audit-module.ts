import { auditModuleControls } from "./audit-module-controls.js";
import {
  auditUniversalStructure,
  outcomeFor,
} from "./audit-universal-structure.js";
import type { AuditResult, ModuleAuditInput } from "./types.js";

export function auditModule(input: ModuleAuditInput): AuditResult {
  const structure = auditUniversalStructure(input.inventory);
  const controls = auditModuleControls(input);
  const findings = [...structure.findings, ...controls.findings];
  return { outcome: outcomeFor(findings), findings };
}
