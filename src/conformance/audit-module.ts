import { auditModuleControls } from "./audit-module-controls.js";
import {
  auditUniversalStructure,
  outcomeFor,
} from "./audit-universal-structure.js";
import type { AuditResult, ModuleAuditInput } from "./types.js";

export function auditModule(input: ModuleAuditInput): AuditResult {
  const contextualExpectation = deriveContextualStructure(
    input.controls.definition,
  );
  const structure = auditUniversalStructure(
    input.inventory,
    contextualExpectation.rootPaths,
  );
  const contextual = auditContextualStructure(
    input.inventory,
    input.controls.definition,
  );
  const controls = auditModuleControls(input);
  const findings = [
    ...structure.findings,
    ...contextual.findings,
    ...controls.findings,
  ];
  return { outcome: outcomeFor(findings), findings };
}
import { deriveContextualStructure } from "./contextual-structure.js";
import { auditContextualStructure } from "./audit-contextual-structure.js";
