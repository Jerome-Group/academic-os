import type {
  ResearchFinding,
  ResearchProjectInventory,
  ResearchProjectProfile,
} from "../conformance/index.js";

export const researchObservationSchemaVersion = 1 as const;
export const researchRuleSetVersion = 1 as const;

export interface ResearchObservationTarget {
  kind: "research-project";
  projectKey: string;
  profile: ResearchProjectProfile;
  identity: string;
}

export interface ResearchAuditObservation {
  observationType: "research-project-audit";
  schemaVersion: typeof researchObservationSchemaVersion;
  ruleSetVersion: typeof researchRuleSetVersion;
  contractVersion: number | "unavailable";
  target: ResearchObservationTarget;
  observedAt: string;
  inventory: ResearchProjectInventory;
  metadataAvailability: {
    contentChecksums: "unavailable" | "entry-specific";
    reason: string;
  };
  findings: ResearchFinding[];
  reportProvenance: {
    producer: "@jerome-group/academic-os";
    producerVersion: "0.1.0";
    reportSchemaVersion: 1;
    command: "audit";
  };
}

export interface CreateResearchAuditObservationInput {
  target: ResearchObservationTarget;
  inventory: ResearchProjectInventory;
  findings: ResearchFinding[];
  observedAt: string;
  contractVersion: number | "unavailable";
}

export type ResearchObservationComparisonBasis =
  | "no-prior-observation"
  | "compatible-observation"
  | "contract-version-changed";

export interface ResearchObservationComparison {
  basis: ResearchObservationComparisonBasis;
  contractChange?: {
    from: number | "unavailable";
    to: number | "unavailable";
  };
  new: ResearchFinding[];
  unchanged: ResearchFinding[];
  resolved: ResearchFinding[];
}
