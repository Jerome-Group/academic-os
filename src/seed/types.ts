export type SeedOutcome = "preview" | "blocked" | "staged" | "published";
export type SeedMode = "preview" | "apply";

export interface SeedOperation {
  kind: "directory" | "file";
  path: string;
  contents?: string;
}

export interface SeedPlan {
  module: string;
  semester: string;
  operations: SeedOperation[];
  blockers: string[];
}

export interface SeedReport {
  schemaVersion: 1;
  module: { code: string; semester: string };
  outcome: SeedOutcome;
  operations: Array<Pick<SeedOperation, "kind" | "path">>;
  evidence: string[];
}
