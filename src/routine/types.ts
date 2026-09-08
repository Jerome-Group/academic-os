import type { ConfiguredModule } from "../config/index.js";
import type { ImportStatusReport } from "../imports/index.js";
import type { TaskRefreshReport } from "../tasks/index.js";
import type { ShelfCatchUpReport } from "../textbooks/index.js";
import type { MaintenanceCoverage } from "./maintenance-domains.js";

export interface RoutineFailure {
  code: string;
  message: string;
}

// The prelude's steps report the same shape so the report renders them identically and the
// wrapper decides on them identically: what it did, what it left for the Owner, why it stopped.
export type PreludeStepName =
  | "import-status"
  | "textbook-shelf-catch-up"
  | "task-register-pull";

// Each prelude operation keeps its own outcome vocabulary; `failed` is the wrapper's for a step
// that never got far enough to produce a report.
export type PreludeStepOutcome =
  | ImportStatusReport["outcome"]
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

// Only a `curated` decision named a destination, so only a line superseding one can repeat it.
export interface SupersededItem {
  item: string;
  destination?: string;
}

export interface RederivedItem {
  item: string;
  derived: string[];
}

// The source this item was decided from has left the importer mirror, so the item is closed. It
// says nothing about the copy the item placed, which stays exactly where the decision put it.
export interface WithdrawnItem {
  item: string;
  evidence: string;
}

export interface ParkedItem {
  item: string;
  reason: string;
  evidence: string;
}

// A fact about the module that is correct now and stays correct. It carries no `evidence` because
// evidence exists to let the Owner settle something, and a note asks them to settle nothing — the
// note states the fact in full and is read rather than actioned.
export interface NotedItem {
  item: string;
  note: string;
}

export interface DocWrite {
  file: string;
  summary: string;
}

// What one module's session reports back — the curation decisions it took, the module docs it
// wrote unattended, the failures it hit, and what it observed without owing the Owner a decision.
// A session that dies reports failures and nothing else.
export interface ModulePassOutcome {
  maintenance: MaintenanceCoverage;
  curated: CuratedItem[];
  rederived: RederivedItem[];
  superseded: SupersededItem[];
  withdrawn: WithdrawnItem[];
  parked: ParkedItem[];
  docWrites: DocWrite[];
  failures: RoutineFailure[];
  noted: NotedItem[];
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
  | "updated"
  | "reopened"
  | "closed"
  | "not-needed"
  | "failed";

export interface MorningIssueReport {
  outcome: MorningIssueOutcome;
  number: number | null;
  numbers?: number[];
  failure?: RoutineFailure;
}

export interface MorningRoutineReport {
  schemaVersion: 2;
  command: "routine morning";
  outcome: "quiet" | "reported" | "unreported";
  date: string;
  prelude: PreludeStepReport[];
  modules: ModulePassReport[];
  purge: RetentionPurge;
  report: string | null;
  issue: MorningIssueReport;
}

// The prelude names its steps rather than returning a list, so the wrapper's order is the
// wrapper's — visible where the run is assembled instead of inside whatever runs the steps.
export interface MorningPreludePort {
  inspectImports(): Promise<PreludeStepReport>;
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
  list(): Promise<MorningIssue[]>;
  raise(input: {
    title: string;
    body: string;
    labels: readonly string[];
  }): Promise<number>;
  update(input: { number: number; body: string }): Promise<void>;
  reopen(number: number): Promise<void>;
  close(number: number): Promise<void>;
}

export interface MorningIssue {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
}
