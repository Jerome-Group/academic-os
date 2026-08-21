export const contractRuleEnforcement = {
  "MF-ADMIN-001": "deterministic",
  "MF-AGENTS-001": "deterministic",
  "MF-AGENTS-002": "deterministic",
  "MF-AGENTS-003": "judgment",
  "MF-AGENTS-004": "deterministic",
  "MF-ASSESSMENTS-001": "deterministic",
  "MF-AUDIT-001": "deterministic",
  "MF-AUDIT-002": "deterministic",
  "MF-AUDIT-003": "deterministic",
  "MF-CONTEXT-001": "deterministic",
  "MF-CURATION-001": "deterministic",
  "MF-CURATION-002": "judgment",
  "MF-CURATION-003": "judgment",
  "MF-CURATION-004": "judgment",
  "MF-DEFINITION-001": "deterministic",
  "MF-DEFINITION-002": "deterministic",
  "MF-DOCS-001": "deterministic",
  "MF-IMPORTER-001": "deterministic",
  "MF-IMPORTER-002": "judgment",
  "MF-LATEX-001": "deterministic",
  "MF-LEARNING-001": "deterministic",
  "MF-LEARNING-002": "deterministic",
  "MF-NAMING-001": "deterministic",
  "MF-NAMING-002": "deterministic",
  "MF-NAMING-003": "judgment",
  "MF-OPEN-001": "deterministic",
  "MF-PROFILE-001": "deterministic",
  "MF-PROFILE-002": "judgment",
  "MF-PROFILE-003": "deterministic",
  "MF-ROOT-001": "deterministic",
  "MF-ROOT-002": "deterministic",
  "MF-ROOT-003": "deterministic",
  "MF-SEED-001": "judgment",
  "MF-SEED-002": "deterministic",
  "MF-SEED-003": "deterministic",
  "MF-TASKS-001": "deterministic",
  "MF-TEXTBOOK-001": "deterministic",
  "MF-TEXTBOOK-002": "deterministic",
  "MF-TEXTBOOK-003": "deterministic",
  "MF-TEXTBOOK-004": "deterministic",
  "MF-TRANSITION-001": "judgment",
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
