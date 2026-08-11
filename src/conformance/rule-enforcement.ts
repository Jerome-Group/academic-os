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

export const contractRuleImplementation: Record<
  keyof typeof contractRuleEnforcement,
  readonly string[]
> = {
  "MF-ADMIN-001": ["src/conformance/audit-structural-placement.ts"],
  "MF-AGENTS-001": ["src/conformance/validate-agents.ts"],
  "MF-AGENTS-002": ["src/conformance/validate-claude.ts"],
  "MF-AGENTS-003": ["src/seed/create-module-seed-plan.ts"],
  "MF-ASSESSMENTS-001": ["src/conformance/contextual-structure.ts"],
  "MF-AUDIT-001": ["src/conformance/audit-module.ts"],
  "MF-AUDIT-002": ["src/observation/compare-audit-observations.ts"],
  "MF-AUDIT-003": ["src/cohort/run-cohort-audit.ts"],
  "MF-CONTEXT-001": ["src/conformance/validate-context.ts"],
  "MF-CURATION-001": ["src/conformance/validate-curation-register.ts"],
  "MF-CURATION-002": ["src/conformance/audit-governed-content.ts"],
  "MF-DEFINITION-001": ["src/conformance/validate-definition.ts"],
  "MF-DEFINITION-002": ["src/conformance/validate-definition.ts"],
  "MF-DOCS-001": ["src/contract/universal-structure.ts"],
  "MF-IMPORTER-001": ["src/conformance/inventory-paths.ts"],
  "MF-LATEX-001": ["src/conformance/audit-latex-builds.ts"],
  "MF-NAMING-001": ["src/conformance/audit-curated-naming.ts"],
  "MF-NAMING-002": ["src/conformance/audit-curated-naming.ts"],
  "MF-NAMING-003": ["src/conformance/audit-curated-naming.ts"],
  "MF-OPEN-001": ["src/conformance/audit-contextual-structure.ts"],
  "MF-PROFILE-001": ["src/conformance/validate-profile.ts"],
  "MF-PROFILE-002": ["src/conformance/validate-profile.ts"],
  "MF-PROFILE-003": ["src/conformance/validate-profile.ts"],
  "MF-ROOT-001": ["src/mounted/resolve-target.ts"],
  "MF-ROOT-002": ["src/conformance/audit-universal-structure.ts"],
  "MF-SEED-001": ["src/cli.ts", "src/seed/create-module-seed-plan.ts"],
  "MF-SEED-002": ["src/mounted/seed-mounted-module.ts"],
  "MF-SEED-003": ["src/seed/create-module-seed-plan.ts"],
  "MF-TUTORIALS-001": ["src/conformance/contextual-structure.ts"],
  "MF-UNIVERSAL-001": ["src/contract/universal-structure.ts"],
  "MF-WORKSPACES-001": ["src/conformance/contextual-structure.ts"],
};

export type ContractRuleId = keyof typeof contractRuleEnforcement;
export type FindingEnforcement =
  (typeof contractRuleEnforcement)[ContractRuleId];

export function enforcementForRule(ruleId: ContractRuleId): FindingEnforcement {
  return contractRuleEnforcement[ruleId];
}
