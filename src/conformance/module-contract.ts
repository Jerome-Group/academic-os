import { universalStructurePaths } from "../contract/universal-structure.js";
import { contractRuleEnforcement } from "./rule-enforcement.js";
import { supportedContractVersion } from "./validate-definition.js";
import type { ContractRuleId, InventoryEntryKind } from "./types.js";

export interface ModuleContract {
  version: number;
  ruleIds: readonly ContractRuleId[];
  universalStructure: ReadonlyArray<readonly [string, InventoryEntryKind]>;
}

export const currentModuleContract: ModuleContract = {
  version: supportedContractVersion,
  ruleIds: Object.keys(contractRuleEnforcement) as ContractRuleId[],
  universalStructure: universalStructurePaths,
};

export function applicableRuleIds(
  contract: ModuleContract,
): Set<ContractRuleId> {
  return new Set(contract.ruleIds);
}
