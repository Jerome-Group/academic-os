import { outcomeFor } from "./audit-universal-structure.js";
import type { ModuleContract } from "./module-contract.js";
import type { AuditResult, ModuleControlAuditInput } from "./types.js";
import { validateAgents } from "./validate-agents.js";
import { validateClaude } from "./validate-claude.js";
import { validateContext } from "./validate-context.js";
import { validateCurationRegister } from "./validate-curation-register.js";
import { validateDefinition } from "./validate-definition.js";
import { validatePinnedDocuments } from "./validate-pinned-documents.js";
import { validateProfile } from "./validate-profile.js";

export function auditModuleControls(
  { moduleCode, semester, controls }: ModuleControlAuditInput,
  contract: ModuleContract,
): AuditResult {
  const definition = validateDefinition(
    controls.definition,
    moduleCode,
    semester,
    contract.version,
  );
  const findings = [
    ...definition.findings,
    ...validateProfile(controls.profile, definition.definition),
    validateCurationRegister(controls.curationRegister),
    validateAgents(controls.agents),
    validateClaude(controls.claude),
    validateContext(controls.context, definition.definition),
    ...validatePinnedDocuments(controls, moduleCode, contract.pinnedDocuments),
  ];
  return { outcome: outcomeFor(findings), findings };
}
