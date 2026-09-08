export const importReceiptStatuses = [
  "running",
  "complete",
  "partial",
  "failed",
] as const;

export type ImportReceiptStatus = (typeof importReceiptStatuses)[number];

export interface ImportCounts {
  downloaded: number;
  skipped: number;
  markdown: number;
  uncopied: number;
  failures: number;
}

export interface ImportStatusReceipt {
  schemaVersion: 1;
  producer: "ntulearn";
  status: ImportReceiptStatus;
  startedAt: string;
  finishedAt: string | null;
  lastSuccessfulAt: string | null;
  counts: ImportCounts;
  unread: Array<"announcements" | "conversations">;
}

export type ImportStatus =
  | "current"
  | "stale"
  | "running"
  | "partial"
  | "failed"
  | "missing"
  | "invalid";

export interface ValidImportStatusReceipt {
  valid: true;
  receipt: ImportStatusReceipt;
}

export interface InvalidImportStatusReceipt {
  valid: false;
  problems: string[];
}

export type ImportStatusReceiptValidation =
  | ValidImportStatusReceipt
  | InvalidImportStatusReceipt;
