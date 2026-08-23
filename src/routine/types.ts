import type { ConfiguredModule } from "../config/index.js";
import type { TaskRefreshReport } from "../tasks/index.js";
import type { ShelfCatchUpReport } from "../textbooks/index.js";

export interface RoutineFailure {
  code: string;
  message: string;
}

// The prelude's two steps report the same shape so the report renders them identically and the
// wrapper decides on them identically: what it did, what it left for the Owner, why it stopped.
export type PreludeStepName = "textbook-shelf-catch-up" | "task-register-pull";

// The step keeps its own word for how it went — the two commands behind the prelude already have
// one each — and `failed` is the wrapper's, for the step that never got far enough to have one.
export type PreludeStepOutcome =
  | ShelfCatchUpReport["outcome"]
  | TaskRefreshReport["outcome"]
  | "failed";

export interface PreludeStepReport {
  step: PreludeStepName;
  outcome: PreludeStepOutcome;
  parked: number;
  detail: string[];
  failure?: RoutineFailure;
}

export interface CuratedItem {
  item: string;
  destination: string;
}

export interface RederivedItem {
  item: string;
  derived: string[];
}

export interface ParkedItem {
  item: string;
  reason: string;
  evidence: string;
}

export interface DocWrite {
  file: string;
  summary: string;
}

// What one module's session reports back — the four curation decisions it took, the module docs it
// wrote unattended, and the failures it hit. A session that dies reports failures and nothing else.
export interface ModulePassOutcome {
  curated: CuratedItem[];
  rederived: RederivedItem[];
  superseded: CuratedItem[];
  parked: ParkedItem[];
  docWrites: DocWrite[];
  failures: RoutineFailure[];
}

export interface ModulePassReport extends ConfiguredModule, ModulePassOutcome {
  artifacts: string;
}

export interface RetentionPurge {
  sessions: string[];
  reports: string[];
}

export type MorningIssueOutcome =
  | "created"
  | "already-raised"
  | "not-needed"
  | "failed";

export interface MorningIssueReport {
  outcome: MorningIssueOutcome;
  number: number | null;
  failure?: RoutineFailure;
}

export interface MorningRoutineReport {
  schemaVersion: 1;
  command: "routine morning";
  outcome: "quiet" | "reported" | "unreported";
  date: string;
  prelude: PreludeStepReport[];
  modules: ModulePassReport[];
  purge: RetentionPurge;
  report: string | null;
  issue: MorningIssueReport;
}

// The prelude names its two steps rather than returning a list, so the wrapper's order is the
// wrapper's — visible where the run is assembled instead of inside whatever runs the steps.
export interface MorningPreludePort {
  catchUpShelf(): Promise<PreludeStepReport>;
  pullTaskRegisters(): Promise<PreludeStepReport>;
}

export interface ModuleSessionPort {
  run(module: ConfiguredModule): Promise<ModulePassReport>;
}

// Dates are the whole of the store's vocabulary: the routine writes one report per calendar day and
// purges by day, so nothing here can reach an artifact that is not the routine's own.
export interface RoutineArtifactStore {
  writeReport(input: { date: string; text: string }): Promise<string>;
  listSessionDates(): Promise<string[]>;
  listReportDates(): Promise<string[]>;
  removeSession(date: string): Promise<void>;
  removeReport(date: string): Promise<void>;
}

export interface MorningIssuePort {
  find(title: string): Promise<number | undefined>;
  raise(input: {
    title: string;
    body: string;
    labels: readonly string[];
  }): Promise<number>;
}
