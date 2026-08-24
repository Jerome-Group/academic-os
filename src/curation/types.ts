import type { RecordedChecksum } from "./recorded-checksum.js";

// One curation-decision event, read but never re-derived: a superseding line is this object with
// its identity fields replaced, so a field this pass does not understand still crosses unchanged.
export type CurationRegisterEvent = Record<string, unknown>;

// Contract v4 identifies an item by its unnumbered source path and the sha-256 of its bytes. A
// legacy line carries neither half — a Drive file ID and an md5 — so it joins against an arrival
// walk on nothing and the item reads as new every morning.
export type CurationIdentity = "contract-v4" | "legacy";

// One item the arrival walk can meet, and the event that currently stands for it. Items are keyed
// by contract-v4 identity's path half, which is the one thing both conventions can be read for.
export interface CurationItem {
  key: string;
  integration: string;
  sourceId: string;
  sourcePath: string;
  unnumberedPath: string;
  identity: CurationIdentity;
  checksum: RecordedChecksum | undefined;
  standing: CurationRegisterEvent;
}

export interface ObservedCurationSource {
  // Inside the importer root, as found in the mirror now — which is not the path the standing line
  // recorded whenever the importer has renumbered a folder since.
  sourcePath: string;
  // Module-relative, so it names the destination folder rather than the integration key: this is
  // the one of the two that a reader can open.
  location: string;
  sha256: string;
  md5: string;
}

export interface ObservedModuleRegister {
  module: string;
  semester: string;
  register: string;
  // The integration keys a register line records, which is what an item is matched on. The folders
  // those sources write into are a different vocabulary and belong to the mirror walk alone.
  integrations: readonly string[];
  // Keyed by contract-v4 identity's path half, which is what the mirror is indexed by.
  sources: ReadonlyMap<string, ObservedCurationSource>;
  // A key two files in the mirror both answer to. Which one a standing line decided cannot be told,
  // so nothing is written for it.
  ambiguousSources: ReadonlySet<string>;
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
  // As the standing line recorded it, beside where the file actually is now — module-relative, so
  // the write can find it again.
  sourcePath: string;
  sourceLocation: string;
  // What the appended line records as `source_id` — the unnumbered path, with no integration on
  // the front, so the report names the identity the register will actually carry.
  becomes: string;
  supersedes: string;
  recordedChecksum: string;
  // What the appended line asserts, and what the write reads the source again to prove.
  sha256: string;
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
  // Counts are per item, because one item can hold several lines of its own history. This is the
  // one figure that is per line, so a superseded legacy line is never invisible.
  legacyLines: number;
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
