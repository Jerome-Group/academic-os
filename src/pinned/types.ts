import type { PinnedDocumentName } from "../contract/pinned-documents.js";

// A copy is `current` when it is byte-identical to the template, `stale` when it differs, and
// `missing` when there is nothing readable there. Only the last two are rewritten.
export type PinnedCopyState = "current" | "stale" | "missing";

export interface ObservedModuleCopies {
  module: string;
  semester: string;
  controls: Partial<Record<PinnedDocumentName, string>>;
}

export interface PinnedCopyRewrite {
  module: string;
  semester: string;
  document: PinnedDocumentName;
  path: string;
  state: Exclude<PinnedCopyState, "current">;
  evidence: string;
  // What the plan was built against, so the write can prove the bytes have not moved since.
  observedSha256: string | null;
  expected: string;
}

// `refused` means the run stopped before writing anything. `partially-rewritten` means a write
// failed after earlier ones had landed — the proving pass makes it unlikely, not impossible, and
// the journal is what says how far the run got.
export type PinnedRefreshOutcome =
  | PinnedCopyState
  | "refused"
  | "partially-rewritten";

export interface UnresolvedModule {
  module: string;
  semester: string;
  reason: string;
}

export interface PinnedRefreshReport {
  schemaVersion: 1;
  command: "pinned refresh";
  mode: "preview" | "apply";
  outcome: PinnedRefreshOutcome;
  counts: Record<PinnedCopyState, number>;
  rewrites: Array<Omit<PinnedCopyRewrite, "expected" | "observedSha256">>;
  unresolved: UnresolvedModule[];
  rewritten: number;
  refusals: string[];
  journal?: string;
}

export interface PinnedRefreshPlan {
  outcome: PinnedCopyState;
  counts: Record<PinnedCopyState, number>;
  rewrites: PinnedCopyRewrite[];
}

export interface CohortPinnedCopies {
  // Resolved roots: a write compares `realpath` of its target against this, so an unresolved value
  // here refuses every rewrite rather than admitting one.
  driveMount: string;
  stateRoot: string;
  modules: ObservedModuleCopies[];
  moduleRoots: Map<string, string>;
  // A module the cohort names that could not be read. Reported rather than thrown, so one folder
  // that has not synced does not hide what the other five owe.
  unresolved: UnresolvedModule[];
}
