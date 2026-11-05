import type { NamingRequest } from "./generated/naming-request-1.js";
export type { NamingPolicy } from "./generated/naming-policy-1.js";
export type { NamingRequest } from "./generated/naming-request-1.js";
export type NamingArtifact = NamingRequest["artifacts"][number];
export type OccupiedPath = NamingRequest["occupiedPaths"][number];

export type NamingDiagnostic = {
  code: string;
  pointer: string;
  message: string;
  evidence: readonly string[];
} & (
  | { kind: "problem" }
  | { kind: "normalization"; original: string; normalized: string; form: "NFC" }
);

export type NamingEntry =
  | {
      kind: "resolved";
      artifact: NamingArtifact;
      path: string;
      filename: string;
      diagnostics: readonly NamingDiagnostic[];
    }
  | {
      kind: "unresolved";
      artifact: NamingArtifact;
      diagnostics: readonly NamingDiagnostic[];
    };

export type NamingPlan =
  | {
      outcome: "refused";
      diagnostics: readonly NamingDiagnostic[];
    }
  | {
      outcome: "resolved" | "unresolved";
      schema: "urn:academic-os:naming-plan:1";
      admission: {
        kind: "not-admitted";
        requiredContractVersion: 8;
        targetContractVersion: number;
        reason: "target-contract-version" | "activation-pending";
      };
      policy: NamingRequest["policy"];
      module: NamingRequest["module"];
      entries: readonly NamingEntry[];
      diagnostics: readonly NamingDiagnostic[];
    };
