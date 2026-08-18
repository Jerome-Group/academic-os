import type { PinnedDocumentBodies } from "../contract/pinned-documents.js";
import { universalStructurePaths } from "../contract/universal-structure.js";
import { contractRuleEnforcement } from "./rule-enforcement.js";
import { supportedContractVersion } from "./validate-definition.js";
import type { ContractRuleId } from "./types.js";

export interface ModuleContract {
  version: number;
  ruleIds: readonly ContractRuleId[];
  universalStructure: ReadonlyArray<readonly [string, "directory" | "file"]>;
  pinnedDocuments: PinnedDocumentBodies;
}

export function moduleContract(
  pinnedDocuments: PinnedDocumentBodies,
): ModuleContract {
  return {
    version: supportedContractVersion,
    ruleIds: Object.keys(contractRuleEnforcement) as ContractRuleId[],
    universalStructure: universalStructurePaths,
    pinnedDocuments,
  };
}

export function applicableRuleIds(
  contract: ModuleContract,
): Set<ContractRuleId> {
  return new Set(contract.ruleIds);
}
