import { pinnedDocumentNames } from "../contract/pinned-documents.js";
import {
  compareAuditObservations,
  createAuditObservation,
  type AuditObservation,
  type ObservationComparison,
  type ObservationTarget,
} from "../observation/index.js";
import { auditModule } from "./audit-module.js";
import { deriveContextualStructure } from "./contextual-structure.js";
import type { ModuleContract } from "./module-contract.js";
import { applicableRuleIds } from "./module-contract.js";
import type {
  AuditResult,
  ContractRuleId,
  Inventory,
  ModuleControls,
} from "./types.js";
import { readDefinitionContractVersion } from "./validate-definition.js";

export interface ProposedConformanceOperation {
  kind: "create-directory" | "create-file";
  path: string;
  ruleId: ContractRuleId;
}

export interface ModuleConformancePlan extends AuditResult {
  proposedOperations: ProposedConformanceOperation[];
  observation: AuditObservation;
  comparison: ObservationComparison;
}

export function planModuleConformance(input: {
  contract: ModuleContract;
  target: ObservationTarget;
  controls: ModuleControls;
  inventory: Inventory;
  priorObservation?: AuditObservation;
  observedAt: string;
}): ModuleConformancePlan {
  assertUsableContract(input.contract);
  const audit = auditModule(
    {
      moduleCode: input.target.moduleCode,
      semester: input.target.semester,
      controls: input.controls,
      inventory: input.inventory,
    },
    input.contract,
  );
  const observation = createAuditObservation({
    target: input.target,
    inventory: input.inventory,
    findings: audit.findings,
    observedAt: input.observedAt,
    contractVersion: readDefinitionContractVersion(input.controls.definition),
  });
  return {
    ...audit,
    proposedOperations: proposedOperations(input),
    observation,
    comparison: compareAuditObservations(observation, input.priorObservation),
  };
}

function assertUsableContract(contract: ModuleContract): void {
  const rules = applicableRuleIds(contract);
  if (
    !Number.isInteger(contract.version) ||
    contract.version <= 0 ||
    contract.ruleIds.length === 0 ||
    rules.size !== contract.ruleIds.length ||
    contract.universalStructure.length === 0 ||
    contract.learningWorkspace.length === 0 ||
    pinnedDocumentNames.some(
      (name) => contract.pinnedDocuments[name] === undefined,
    )
  ) {
    throw new TypeError("Conformance planning requires a complete contract.");
  }
}

function proposedOperations(input: {
  contract: ModuleContract;
  controls: ModuleControls;
  inventory: Inventory;
}): ProposedConformanceOperation[] {
  const applicable = applicableRuleIds(input.contract);
  const present = new Set(input.inventory.entries.map(({ path }) => path));
  const universal = input.contract.universalStructure.flatMap(
    ([path, kind]): ProposedConformanceOperation[] =>
      present.has(path) || !applicable.has("MF-UNIVERSAL-001")
        ? []
        : [
            {
              kind: kind === "directory" ? "create-directory" : "create-file",
              path,
              ruleId: "MF-UNIVERSAL-001",
            },
          ],
  );
  const workspace = input.contract.learningWorkspace.flatMap(
    ([path, kind]): ProposedConformanceOperation[] =>
      present.has(path) || !applicable.has("MF-LEARNING-001")
        ? []
        : [
            {
              kind: kind === "directory" ? "create-directory" : "create-file",
              path,
              ruleId: "MF-LEARNING-001",
            },
          ],
  );
  const contextual = deriveContextualStructure(
    input.controls.definition,
  ).paths.flatMap((path): ProposedConformanceOperation[] =>
    present.has(path) || !applicable.has(contextualRule(path))
      ? []
      : [{ kind: "create-directory", path, ruleId: contextualRule(path) }],
  );
  return [...universal, ...workspace, ...contextual].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function contextualRule(path: string): ContractRuleId {
  if (path.startsWith("20 Tutorials/")) return "MF-TUTORIALS-001";
  if (path.startsWith("30 Assessments/")) return "MF-ASSESSMENTS-001";
  if (path.startsWith("40 Projects and Labs/")) return "MF-WORKSPACES-001";
  if (path.startsWith("90 Resources/")) return "MF-OPEN-001";
  return "MF-IMPORTER-001";
}
