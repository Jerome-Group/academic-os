import type { CurationRegisterEvent } from "./types.js";

// One `curated` line of an item's standing batch, and what the mount says about the destination it
// named. The batch is what a single pass appended for one item — every line sharing that item's
// `source_id` and `timestamp` — so a split is visible as a batch naming more than one destination.
export interface StandingCuratedLine {
  destination: string;
  // Absent when the line records no digest this pass can compare. One such line does not stop the
  // item: `docs/adr/0022` is why the smaller claim gets the smaller answer.
  recordedSha256: string | undefined;
}

// A source a split correction could be about, read off the register alone. Whether it is one is
// decided against the bytes.
export interface CurationSplitCandidate {
  key: string;
  integration: string;
  sourceId: string;
  unnumberedPath: string;
  sourcePath: string;
  timestamp: string;
  identity: "contract-v4" | "legacy";
  notation: "bare" | "prefixed";
  standing: CurationRegisterEvent;
  lines: StandingCuratedLine[];
}

// What the mirror holds for a candidate's source, now.
export interface ObservedRederivationSource {
  // Where the file actually is, module-relative, which is what the write reads again to prove it.
  location: string;
  sourcePath: string;
  sha256: string;
}

export interface ObservedModuleRederivation {
  module: string;
  semester: string;
  register: string;
  integrations: readonly string[];
  // Keyed by item key, for candidate items alone. Hashing a whole mirror to answer a question about
  // a handful of split sources would read the Owner's material for no decision this pass can reach.
  sources: ReadonlyMap<string, ObservedRederivationSource>;
  // Module-relative destination path to the sha-256 of its bytes now. A path absent from this map
  // is not on the mount.
  artifacts: ReadonlyMap<string, string>;
}

export interface CohortCurationRederivations {
  driveMount: string;
  stateRoot: string;
  modules: ObservedModuleRederivation[];
  moduleRoots: Map<string, string>;
  unresolved: Array<{ module: string; semester: string; reason: string }>;
}

export type CurationSplitState =
  | "settled"
  | "rederiving"
  | "changed"
  | "legacy-identity"
  | "unprovable"
  | "missing-source";

export type CurationSplitCounts = Record<CurationSplitState, number>;

export interface PlannedCurationRederivation {
  key: string;
  integration: string;
  sourcePath: string;
  sourceLocation: string;
  // `<source_id>@<timestamp>`, which names every line the batch wrote because they share both
  // halves — the idiom `docs/adr/0019` established for a superseding line.
  supersedes: string;
  sha256: string;
  // Module-relative, sorted: the artifacts the work produced, which is what the appended line
  // asserts and the only thing it asserts.
  derived: string[];
  // Destinations holding the source's own bytes. Their `curated` lines are correct and stay
  // standing beside the appended one.
  copies: string[];
  // Named so the Owner can see what the correction could not read or could not find, rather than
  // discovering later that `derived` is shorter than the batch was.
  unreadable: string[];
  missing: string[];
  // The exact JSON the register gains, so preview and apply are the same bytes.
  line: string;
}

export interface CurationSplitDiscrepancy {
  key: string;
  integration: string;
  sourcePath: string;
  state: Exclude<CurationSplitState, "settled" | "rederiving">;
  evidence: string;
}

export interface ModuleCurationRederivationPlan {
  module: string;
  semester: string;
  counts: CurationSplitCounts;
  rederivations: PlannedCurationRederivation[];
  discrepancies: CurationSplitDiscrepancy[];
  // A register this pass will not append to at all, and why. Reported rather than thrown, so one
  // malformed file does not hide what the rest of the cohort owes.
  blockers: string[];
  observedSha256: string;
}

export interface CurationRederivationPlan {
  outcome: "settled" | "split";
  counts: CurationSplitCounts;
  modules: ModuleCurationRederivationPlan[];
}

export type CurationRederivationOutcome =
  | "settled"
  | "split"
  | "refused"
  | "partially-corrected";

export interface CurationRederivationReport {
  schemaVersion: 1;
  command: "curation rederive";
  mode: "preview" | "apply";
  outcome: CurationRederivationOutcome;
  counts: CurationSplitCounts;
  modules: Array<
    Omit<ModuleCurationRederivationPlan, "rederivations" | "observedSha256"> & {
      rederivations: Array<Omit<PlannedCurationRederivation, "line">>;
    }
  >;
  unresolved: CohortCurationRederivations["unresolved"];
  appended: number;
  refusals: string[];
  journal?: string;
}
