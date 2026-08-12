import { auditModuleControls } from "./audit-module-controls.js";
import { auditContextualStructure } from "./audit-contextual-structure.js";
import { auditGovernedContent } from "./audit-governed-content.js";
import {
  auditUniversalStructure,
  outcomeFor,
} from "./audit-universal-structure.js";
import { deriveContextualStructure } from "./contextual-structure.js";
import type { AuditResult, ModuleAuditInput } from "./types.js";
import {
  applicableRuleIds,
  currentModuleContract,
  type ModuleContract,
} from "./module-contract.js";

export function auditModule(
  input: ModuleAuditInput,
  contract: ModuleContract = currentModuleContract,
): AuditResult {
  const contextualExpectation = deriveContextualStructure(
    input.controls.definition,
  );
  const structure = auditUniversalStructure(
    input.inventory,
    contextualExpectation.rootPaths,
    contract.universalStructure,
  );
  const contextual = auditContextualStructure(
    input.inventory,
    input.controls.definition,
  );
  const controls = auditModuleControls(input, contract.version);
  const governed = auditGovernedContent(
    input.inventory,
    input.controls.definition,
  );
  const applicable = applicableRuleIds(contract);
  const findings = [
    ...structure.findings,
    ...contextual.findings,
    ...controls.findings,
    ...governed.findings,
  ].filter(({ ruleId }) => applicable.has(ruleId));
  return { outcome: outcomeFor(findings), findings };
}
