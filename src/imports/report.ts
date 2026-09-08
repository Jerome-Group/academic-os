import type { ConfiguredModule } from "../config/index.js";
import type { ImportCounts, ImportStatus } from "./types.js";

export interface ImportRootStatus {
  destination: string;
  status: ImportStatus;
  action: string;
  counts: ImportCounts | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessfulAt: string | null;
  unread: string[] | null;
  error?: string;
}

export interface ModuleImportStatus {
  module: ConfiguredModule;
  status: "observed" | "invalid";
  roots: ImportRootStatus[];
  error?: { code: string; message: string };
}

export interface ImportStatusSummary {
  roots: Record<ImportStatus, number>;
  invalidModules: number;
}

export interface ImportStatusReport {
  schemaVersion: 1;
  mode: "imports-status";
  activeSemester: string;
  observedAt: string;
  maxAgeHours: number;
  outcome: "current" | "attention" | "invalid";
  selection: {
    included: ConfiguredModule[];
    excluded: Array<ConfiguredModule & { reason: "past" | "future" }>;
    unresolved: Array<ConfiguredModule & { reason: string }>;
  };
  summary: ImportStatusSummary;
  modules: ModuleImportStatus[];
}

export function actionForImportStatus(status: ImportStatus): string {
  switch (status) {
    case "current":
      return "none";
    case "stale":
      return "run NTULearn sync";
    case "missing":
      return "deploy a compatible importer, then run the next normal sync";
    case "running":
      return "check the importer if this attempt does not finish";
    case "partial":
    case "failed":
      return "inspect and retry the NTULearn sync";
    case "invalid":
      return "inspect the receipt source, schema version, timestamps, and clock";
  }
}
