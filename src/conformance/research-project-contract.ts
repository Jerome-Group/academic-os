import {
  researchProjectUniversalStructure,
  urecaResearchProjectStructure,
} from "../contract/research-project-structure.js";
import {
  type ResearchContractRuleId,
  researchContractRuleEnforcement,
} from "./research-rule-enforcement.js";
import type { ResearchProjectProfile } from "./research-types.js";
import { supportedResearchContractVersion } from "./validate-research-project-definition.js";

export type ResearchProjectStructure = ReadonlyArray<
  readonly [string, "directory" | "file"]
>;

export interface ResearchProjectContract {
  version: number;
  ruleIds: readonly ResearchContractRuleId[];
  universalStructure: ResearchProjectStructure;
  profiles: Record<ResearchProjectProfile, ResearchProjectStructure>;
  seedFiles: Readonly<Record<string, string>>;
}

export function researchProjectContract(
  seedFiles: Readonly<Record<string, string>>,
): ResearchProjectContract {
  return {
    version: supportedResearchContractVersion,
    ruleIds: Object.keys(
      researchContractRuleEnforcement,
    ) as ResearchContractRuleId[],
    universalStructure: researchProjectUniversalStructure,
    profiles: {
      generic: [],
      ureca: urecaResearchProjectStructure,
    },
    seedFiles,
  };
}

export function applicableResearchRuleIds(
  contract: ResearchProjectContract,
): Set<ResearchContractRuleId> {
  return new Set(contract.ruleIds);
}
