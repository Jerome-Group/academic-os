export const researchContractRuleEnforcement = {
  "RP-ADMIN-001": "deterministic",
  "RP-AGENTS-001": "deterministic",
  "RP-AGENTS-002": "deterministic",
  "RP-AGENTS-003": "judgment",
  "RP-AGENTS-004": "deterministic",
  "RP-AUDIT-001": "deterministic",
  "RP-AUDIT-002": "deterministic",
  "RP-AUDIT-003": "deterministic",
  "RP-CALENDAR-001": "deterministic",
  "RP-CONTEXT-001": "deterministic",
  "RP-DEFINITION-001": "deterministic",
  "RP-DEFINITION-002": "deterministic",
  "RP-DELIVERABLES-001": "deterministic",
  "RP-DELIVERABLES-002": "judgment",
  "RP-DELIVERABLES-003": "deterministic",
  "RP-DOCS-001": "deterministic",
  "RP-INTEGRITY-001": "judgment",
  "RP-NAMING-001": "deterministic",
  "RP-NAMING-002": "judgment",
  "RP-NAMING-003": "deterministic",
  "RP-LATEX-001": "deterministic",
  "RP-PROFILE-001": "deterministic",
  "RP-PROFILE-002": "judgment",
  "RP-PROFILE-003": "deterministic",
  "RP-PROFILE-STRUCTURE-001": "deterministic",
  "RP-RESEARCH-001": "deterministic",
  "RP-RESEARCH-002": "judgment",
  "RP-RESEARCH-003": "judgment",
  "RP-RESEARCH-004": "judgment",
  "RP-ROOT-001": "deterministic",
  "RP-ROOT-002": "deterministic",
  "RP-ROOT-003": "deterministic",
  "RP-SOURCES-001": "deterministic",
  "RP-SOURCES-002": "deterministic",
  "RP-SOURCES-003": "judgment",
  "RP-SEED-001": "judgment",
  "RP-SEED-002": "deterministic",
  "RP-TASKS-001": "deterministic",
  "RP-TRANSITION-001": "judgment",
  "RP-UNIVERSAL-001": "deterministic",
} as const;

export type ResearchContractRuleId =
  keyof typeof researchContractRuleEnforcement;
export type ResearchFindingEnforcement =
  (typeof researchContractRuleEnforcement)[ResearchContractRuleId];

export function researchEnforcementForRule(
  ruleId: ResearchContractRuleId,
): ResearchFindingEnforcement {
  return researchContractRuleEnforcement[ruleId];
}
