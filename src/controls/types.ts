import type { SourceMapUnitEntry } from "../conformance/source-map.js";
import type { ModuleHead } from "./generated/module-head-1.js";
import type { ControlGeneration } from "./generated/control-generation-1.js";
import type { ModuleIdentity } from "./generated/module-identity-1.js";
import type { ModuleDataGeneration } from "./generated/control-generation-2.js";
import type { SupportedModuleData } from "./generated/supported-controls.js";

export type CanonicalControl =
  | {
      readonly role: "module-identity";
      readonly path: string;
      readonly value: ModuleIdentity;
    }
  | {
      readonly role: SupportedModuleData["role"];
      readonly path: string;
      readonly value: SupportedModuleData;
    };

export type ControlObservation =
  | { readonly kind: "file"; readonly path: string; readonly bytes: Uint8Array }
  | {
      readonly kind: "unreadable";
      readonly failure: "io" | "unsafe";
      readonly path: string;
      readonly reason: string;
    };

export interface ControlDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly pointer: string;
  readonly message: string;
  readonly remediation: string;
}

export interface ControlEvidence {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly bytesBase64: string;
}

export interface LegacyDocument {
  readonly path: string;
  readonly format: "yaml" | "markdown" | "jsonl";
  readonly source: string;
  readonly value: unknown;
}

export type ObservedClaim =
  | { readonly kind: "unknown" }
  | { readonly kind: "observed"; readonly value: unknown };

export interface LegacyLearningRecord {
  readonly path: string;
  readonly value: unknown;
  readonly target: ObservedClaim;
  readonly status: ObservedClaim;
  readonly unit: ObservedClaim;
  readonly topics: ObservedClaim;
  readonly supersedes: readonly (string | number)[];
  readonly supersedesRepresentation: "absent" | "scalar" | "list" | "invalid";
}

export interface LegacyControlShape {
  readonly kind: "legacy";
  readonly declared: {
    readonly schemaVersion: unknown;
    readonly contractVersion: unknown;
  };
  readonly procedureFingerprints: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly missingControls: readonly string[];
  readonly reader: "legacy-observed/1";
}

export type ControlRead =
  | {
      readonly kind: "legacy";
      readonly shape: LegacyControlShape;
      readonly evidence: readonly ControlEvidence[];
      readonly documents: readonly LegacyDocument[];
      readonly sourceMap:
        | { readonly kind: "absent" }
        | { readonly kind: "invalid" }
        | {
            readonly kind: "read";
            readonly units: readonly SourceMapUnitEntry[];
          };
      readonly records: readonly LegacyLearningRecord[];
      readonly diagnostics: readonly ControlDiagnostic[];
      readonly coverage: "legacy-observation-only";
    }
  | {
      readonly kind: "canonical";
      readonly shape: {
        readonly kind: "canonical";
        readonly head: ModuleHead;
        readonly generation: ControlGeneration | ModuleDataGeneration;
      };
      readonly evidence: readonly ControlEvidence[];
      readonly controls: readonly CanonicalControl[];
      readonly diagnostics: readonly ControlDiagnostic[];
      readonly coverage: "incomplete-module-contract" | "validated-module-data";
      readonly unsupportedReads: readonly string[];
      readonly readiness: {
        readonly publication: "not-implemented";
        readonly workflows: "not-implemented";
        readonly moduleConformance: "not-implemented";
        readonly migration: "not-implemented";
        readonly verification?: "not-implemented";
      };
      readonly limitations: readonly string[];
    }
  | {
      readonly kind: "unsupported";
      readonly shape: {
        readonly kind: "unsupported";
        readonly detected: "canonical" | "conflicting-observations";
      };
      readonly evidence: readonly ControlEvidence[];
      readonly diagnostics: readonly ControlDiagnostic[];
      readonly coverage: "no-supported-read";
    };

export interface ControlReadInput {
  readonly moduleCode: string;
  readonly files: readonly ControlObservation[];
}

export function diagnostic(
  code: string,
  path: string,
  message: string,
  remediation: string,
  pointer = "",
): ControlDiagnostic {
  return { code, path, pointer, message, remediation };
}
