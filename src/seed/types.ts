export type SeedOutcome =
  | "preview"
  | "blocked"
  | "safely-resumable"
  | "partially-completed"
  | "completed"
  | "abandoned-staging";
export type SeedMode = "preview" | "apply";

export interface SeedOperation {
  kind: "directory" | "file";
  path: string;
  contents?: string;
  contentsBase64?: string;
}

export type ResearchProjectInitialFile =
  | {
      destination: string;
      encoding: "utf8";
      contents: string;
    }
  | {
      destination: string;
      encoding: "binary";
      contentsBase64: string;
    };

export interface SeedPlan {
  module: string;
  semester: string;
  operations: SeedOperation[];
  blockers: string[];
}

export interface ResearchProjectSeedPlan {
  target: {
    kind: "research-project";
    key: string;
    folder: string;
  };
  contractVersion: number;
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

export interface ResearchProjectSeedReport {
  schemaVersion: 1;
  project: { key: string; folder: string };
  outcome: SeedOutcome;
  operations: Array<Pick<SeedOperation, "kind" | "path">>;
  evidence: string[];
}
