import {
  learningWorkspacePaths,
  type LearningWorkspaceFiles,
} from "../contract/learning-workspace.js";
import type { PinnedDocumentBodies } from "../contract/pinned-documents.js";
import { universalStructurePaths } from "../contract/universal-structure.js";
import { contractRuleEnforcement } from "./rule-enforcement.js";
import { supportedContractVersion } from "./validate-definition.js";
import type { ContractRuleId } from "./types.js";

export interface ModuleContract {
  version: number;
  ruleIds: readonly ContractRuleId[];
  universalStructure: ReadonlyArray<readonly [string, "directory" | "file"]>;
  learningWorkspace: ReadonlyArray<readonly [string, "directory" | "file"]>;
  learningWorkspaceFiles: LearningWorkspaceFiles;
  pinnedDocuments: PinnedDocumentBodies;
}

export function moduleContract(bodies: {
  pinnedDocuments: PinnedDocumentBodies;
  learningWorkspaceFiles: LearningWorkspaceFiles;
}): ModuleContract {
  return {
    version: supportedContractVersion,
    ruleIds: Object.keys(contractRuleEnforcement) as ContractRuleId[],
    universalStructure: universalStructurePaths,
    learningWorkspace: learningWorkspacePaths,
    learningWorkspaceFiles: bodies.learningWorkspaceFiles,
    pinnedDocuments: bodies.pinnedDocuments,
  };
}

export function applicableRuleIds(
  contract: ModuleContract,
): Set<ContractRuleId> {
  return new Set(contract.ruleIds);
}
