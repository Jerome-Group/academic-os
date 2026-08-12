import type {
  AuditResult,
  Inventory,
  ModuleControls,
} from "../conformance/index.js";
import type {
  AuditObservation,
  ObservationComparison,
} from "../observation/index.js";

export interface LocalConfig {
  driveMount: string;
  stateRoot: string;
  semester: string;
  module: string;
  semesterRoots: Record<string, string>;
  driveApi?: {
    moduleFolderId: string;
  };
}

export interface ResolvedTarget {
  driveMount: string;
  stateRoot: string;
  semesterRoot: string;
  moduleRoot: string;
  semester: string;
  module: string;
}

export interface MountedInventoryResult {
  target: ResolvedTarget;
  inventory: Inventory;
}

export interface MountedAuditInputResult extends MountedInventoryResult {
  controls: ModuleControls;
}

export interface RecordMountedAuditObservationInput
  extends MountedAuditInputResult {
  result: AuditResult;
  observedAt: string;
  contractVersion: number | "unavailable";
}

export interface ObservationPublisher {
  publish(temporary: string, destination: string): Promise<void>;
}

export type SeedExecutionCheckpoint =
  | "before-staging"
  | "during-staging"
  | "before-publication"
  | "during-publication"
  | "after-publication";

export interface SeedExecutionCheckpointEvent {
  checkpoint: SeedExecutionCheckpoint;
  operation?: { kind: "directory" | "file"; path: string };
}

export interface SeedExecutionOptions {
  resume?: boolean;
  checkpoint?: (event: SeedExecutionCheckpointEvent) => Promise<void>;
}

export type HistoryDiagnosticKind =
  | "missing-history"
  | "corrupt-history"
  | "incompatible-history"
  | "interrupted-write";

export interface HistoryDiagnostic {
  kind: HistoryDiagnosticKind;
  path: string;
  message: string;
}

export interface MountedAuditHistory {
  previous?: AuditObservation;
  diagnostics: HistoryDiagnostic[];
}

export interface AppendMountedAuditObservationInput {
  target: ResolvedTarget;
  observation: AuditObservation;
  comparison: ObservationComparison;
  historyDiagnostics: HistoryDiagnostic[];
}

export interface RecordedAuditObservation {
  observation: AuditObservation;
  observationPath: string;
  comparison: ObservationComparison;
  historyDiagnostics: HistoryDiagnostic[];
}
