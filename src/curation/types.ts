import type { RecordedChecksum } from "./recorded-checksum.js";

export interface CurationRegisterLine {
  lineNumber: number;
  text: string;
  event: Record<string, unknown>;
}

// Contract v4 identifies an item by its unnumbered source path and the sha-256 of its bytes. A
// legacy line carries neither half — a Drive file ID and an md5 — so it joins against an arrival
// walk on nothing and the item reads as new every morning.
export type CurationIdentity = "contract-v4" | "legacy";

// One item the arrival walk can meet, and the line that currently stands for it. Items are keyed
// by contract-v4 identity's path half, which is the one thing both conventions can be read for.
export interface CurationItem {
  key: string;
  integration: string;
  sourceId: string;
  sourcePath: string;
  unnumberedPath: string;
  identity: CurationIdentity;
  checksum: RecordedChecksum | undefined;
  standing: CurationRegisterLine;
}

export interface ObservedCurationSource {
  sha256: string;
  md5: string;
}

export interface ObservedModuleRegister {
  module: string;
  semester: string;
  register: string;
  importerRoots: readonly string[];
  // Keyed as the register records the source: `${integration}/${source_path}`.
  sources: ReadonlyMap<string, ObservedCurationSource>;
}

export interface UnresolvedCurationModule {
  module: string;
  semester: string;
  reason: string;
}

export interface CohortCurationRegisters {
  driveMount: string;
  stateRoot: string;
  modules: ObservedModuleRegister[];
  moduleRoots: Map<string, string>;
  unresolved: UnresolvedCurationModule[];
}

export type CurationIdentityState =
  | "contract-v4"
  | "migrating"
  | "changed"
  | "unprovable"
  | "missing-source";

export type CurationIdentityCounts = Record<CurationIdentityState, number>;

export interface PlannedCurationMigration {
  key: string;
  integration: string;
  sourcePath: string;
  supersedes: string;
  from: string;
  to: string;
  // The exact JSON the register gains, so preview and apply are the same bytes.
  line: string;
}

export interface CurationDiscrepancy {
  key: string;
  integration: string;
  sourcePath: string;
  state: Exclude<CurationIdentityState, "contract-v4" | "migrating">;
  evidence: string;
}

export interface ModuleCurationIdentityPlan {
  module: string;
  semester: string;
  counts: CurationIdentityCounts;
  migrations: PlannedCurationMigration[];
  discrepancies: CurationDiscrepancy[];
  // A register this pass will not append to at all, and why. Reported rather than thrown, so one
  // malformed file does not hide what the rest of the cohort owes.
  blockers: string[];
  observedSha256: string;
}

export type CurationIdentityOutcome =
  | "contract-v4"
  | "legacy"
  | "refused"
  | "partially-migrated";

export interface CurationIdentityPlan {
  outcome: Extract<CurationIdentityOutcome, "contract-v4" | "legacy">;
  counts: CurationIdentityCounts;
  modules: ModuleCurationIdentityPlan[];
}

export interface CurationIdentityReport {
  schemaVersion: 1;
  command: "curation migrate";
  mode: "preview" | "apply";
  outcome: CurationIdentityOutcome;
  counts: CurationIdentityCounts;
  modules: Array<
    Omit<ModuleCurationIdentityPlan, "migrations" | "observedSha256"> & {
      migrations: Array<Omit<PlannedCurationMigration, "line">>;
    }
  >;
  unresolved: UnresolvedCurationModule[];
  appended: number;
  refusals: string[];
  journal?: string;
}
