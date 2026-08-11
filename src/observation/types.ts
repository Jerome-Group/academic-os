import type { Finding, Inventory } from "../conformance/index.js";

export const observationSchemaVersion = 1 as const;
export const ruleSetVersion = 1 as const;

export interface ObservationTarget {
  moduleCode: string;
  semester: string;
  identity: string;
}

export interface AuditObservation {
  schemaVersion: typeof observationSchemaVersion;
  ruleSetVersion: typeof ruleSetVersion;
  contractVersion: number | "unavailable";
  target: ObservationTarget;
  observedAt: string;
  inventory: Inventory;
  metadataAvailability: {
    contentChecksums: "unavailable";
    reason: string;
  };
  findings: Finding[];
  reportProvenance: {
    producer: "@jerome-group/academic-os";
    producerVersion: "0.1.0";
    reportSchemaVersion: 1;
    command: "audit";
  };
}

export interface CreateAuditObservationInput {
  target: ObservationTarget;
  inventory: Inventory;
  findings: Finding[];
  observedAt: string;
  contractVersion: number | "unavailable";
}

export type ComparisonBasis =
  | "no-prior-observation"
  | "compatible-observation"
  | "contract-version-changed";

export interface ObservationComparison {
  basis: ComparisonBasis;
  contractChange?: {
    from: number | "unavailable";
    to: number | "unavailable";
  };
  new: Finding[];
  unchanged: Finding[];
  resolved: Finding[];
}
