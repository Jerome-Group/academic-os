export const contractRuleEnforcement = {
  "MF-ADMIN-001": "deterministic",
  "MF-AGENTS-001": "deterministic",
  "MF-AGENTS-002": "deterministic",
  "MF-AGENTS-003": "judgment",
  "MF-ASSESSMENTS-001": "deterministic",
  "MF-AUDIT-001": "deterministic",
  "MF-AUDIT-002": "deterministic",
  "MF-AUDIT-003": "deterministic",
  "MF-CONTEXT-001": "deterministic",
  "MF-CURATION-001": "deterministic",
  "MF-CURATION-002": "judgment",
  "MF-DEFINITION-001": "deterministic",
  "MF-DEFINITION-002": "deterministic",
  "MF-DOCS-001": "deterministic",
  "MF-IMPORTER-001": "deterministic",
  "MF-LATEX-001": "deterministic",
  "MF-NAMING-001": "deterministic",
  "MF-NAMING-002": "deterministic",
  "MF-NAMING-003": "judgment",
  "MF-OPEN-001": "deterministic",
  "MF-PROFILE-001": "deterministic",
  "MF-PROFILE-002": "judgment",
  "MF-PROFILE-003": "deterministic",
  "MF-ROOT-001": "deterministic",
  "MF-ROOT-002": "deterministic",
  "MF-SEED-001": "judgment",
  "MF-SEED-002": "deterministic",
  "MF-SEED-003": "deterministic",
  "MF-TUTORIALS-001": "deterministic",
  "MF-UNIVERSAL-001": "deterministic",
  "MF-WORKSPACES-001": "deterministic",
} as const;

export type ContractRuleId = keyof typeof contractRuleEnforcement;
export type FindingEnforcement =
  (typeof contractRuleEnforcement)[ContractRuleId];

export function enforcementForRule(ruleId: ContractRuleId): FindingEnforcement {
  return contractRuleEnforcement[ruleId];
}
