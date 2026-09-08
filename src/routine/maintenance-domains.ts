export const MAINTENANCE_STATUSES = [
  "checked",
  "maintained",
  "parked",
  "failed",
  "not-applicable",
] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_DOMAINS = [
  {
    id: "import-health",
    label: "Import health",
    ruleIds: ["MF-IMPORTER-001", "MF-ROOT-003"],
  },
  {
    id: "structure-controls",
    label: "Structure and controls",
    ruleIds: [
      "MF-ADMIN-001",
      "MF-DEFINITION-001",
      "MF-DEFINITION-002",
      "MF-NAMING-001",
      "MF-NAMING-002",
      "MF-NAMING-003",
      "MF-OPEN-001",
      "MF-PROFILE-001",
      "MF-PROFILE-002",
      "MF-PROFILE-003",
      "MF-ROOT-001",
      "MF-ROOT-002",
      "MF-UNIVERSAL-001",
    ],
  },
  {
    id: "curation",
    label: "Curation",
    ruleIds: [
      "MF-CURATION-001",
      "MF-CURATION-002",
      "MF-CURATION-003",
      "MF-CURATION-004",
      "MF-CURATION-005",
      "MF-CURATION-006",
    ],
  },
  {
    id: "tasks-calendar",
    label: "Tasks and calendar",
    ruleIds: ["MF-TASKS-001"],
  },
  {
    id: "learning-sources",
    label: "Learning sources",
    ruleIds: ["MF-LEARNING-001", "MF-LEARNING-002"],
  },
  {
    id: "textbooks",
    label: "Textbooks",
    ruleIds: [
      "MF-TEXTBOOK-001",
      "MF-TEXTBOOK-002",
      "MF-TEXTBOOK-003",
      "MF-TEXTBOOK-004",
    ],
  },
  {
    id: "assessments-projects",
    label: "Assessments and projects",
    ruleIds: ["MF-ASSESSMENTS-001", "MF-TUTORIALS-001", "MF-WORKSPACES-001"],
  },
  {
    id: "cheatsheets-builds",
    label: "Cheatsheets and builds",
    ruleIds: [
      "MF-CHEATSHEET-001",
      "MF-CHEATSHEET-002",
      "MF-CHEATSHEET-003",
      "MF-CHEATSHEET-004",
      "MF-CHEATSHEET-005",
      "MF-CHEATSHEET-006",
      "MF-LATEX-001",
    ],
  },
  {
    id: "documentation-lifecycle",
    label: "Documentation and lifecycle",
    ruleIds: [
      "MF-AGENTS-001",
      "MF-AGENTS-002",
      "MF-AGENTS-003",
      "MF-AGENTS-004",
      "MF-AUDIT-001",
      "MF-AUDIT-002",
      "MF-AUDIT-003",
      "MF-CONTEXT-001",
      "MF-DOCS-001",
      "MF-SEED-001",
      "MF-SEED-002",
      "MF-SEED-003",
      "MF-TRANSITION-001",
    ],
  },
] as const;

export type MaintenanceDomainId = (typeof MAINTENANCE_DOMAINS)[number]["id"];

export interface MaintenanceDomainOutcome {
  domain: MaintenanceDomainId;
  status: MaintenanceStatus;
  evidence: string[];
}

export type MaintenanceCoverage = MaintenanceDomainOutcome[];

export function maintenanceDomainLabel(domain: MaintenanceDomainId): string {
  return (
    MAINTENANCE_DOMAINS.find((entry) => entry.id === domain)?.label ?? domain
  );
}

export function isQuietMaintenanceCoverage(
  coverage: readonly MaintenanceDomainOutcome[],
): boolean {
  return (
    coverage.length === MAINTENANCE_DOMAINS.length &&
    new Set(coverage.map(({ domain }) => domain)).size ===
      MAINTENANCE_DOMAINS.length &&
    MAINTENANCE_DOMAINS.every(({ id }) =>
      coverage.some(
        ({ domain, status, evidence }) =>
          domain === id &&
          (status === "checked" ||
            status === "maintained" ||
            status === "not-applicable") &&
          evidence.length > 0 &&
          evidence.every((item) => item.trim().length > 0),
      ),
    )
  );
}
