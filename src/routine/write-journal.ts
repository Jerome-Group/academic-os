import { posix } from "node:path";

import type { ModulePassOutcome, RoutineFailure } from "./types.js";

export const WRITE_JOURNAL_SCHEMA_VERSION = 1;
export const WRITE_JOURNAL_FILENAME = "operations.jsonl";

const operations = new Set(["create-directory", "create-file", "replace-file"]);
const outcomes = new Set(["completed", "refused", "failed"]);
const proofNames = [
  "containment",
  "deliberateTarget",
  "materialization",
  "freshReading",
] as const;

export interface ValidatedWriteJournal {
  valid: boolean;
  operations: number;
  completedPaths: string[];
  failures: RoutineFailure[];
}

export function validateWriteJournal(input: {
  contents: string;
  outcome: ModulePassOutcome;
  changedPaths: string[];
}): ValidatedWriteJournal {
  const failures: RoutineFailure[] = [];
  const lines = input.contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const completedPaths = new Set<string>();
  const ids = new Set<string>();

  for (let index = 0; index < lines.length; index += 2) {
    const intent = parseRecord(lines[index], index + 1, failures);
    const result = parseRecord(lines[index + 1], index + 2, failures);
    if (intent === undefined || result === undefined) continue;
    if (!isIntent(intent, index + 1, failures)) continue;
    if (!isResult(result, index + 2, failures)) continue;
    if (ids.has(intent.id)) {
      invalid(failures, `intent id ${intent.id} is repeated`);
      continue;
    }
    ids.add(intent.id);
    if (
      result.id !== intent.id ||
      result.path !== intent.path ||
      result.operation !== intent.operation
    ) {
      invalid(
        failures,
        `lines ${index + 1}-${index + 2} are not a matching intent/result pair`,
      );
      continue;
    }
    if (result.outcome === "completed") completedPaths.add(result.path);
    else
      failures.push({
        code: "write-journal-operation-incomplete",
        message: `The session journal records ${result.operation} at ${result.path} as ${result.outcome}: ${String(result.actual)}.`,
      });
  }

  const reportedPaths = new Set([
    ...input.outcome.curated.map(({ destination }) => destination),
    ...input.outcome.rederived.flatMap(({ derived }) => derived),
    ...input.outcome.docWrites.map(({ file }) => file),
    ...input.changedPaths,
  ]);
  for (const path of reportedPaths) {
    if (!completedPaths.has(path)) {
      invalid(
        failures,
        `reported or post-audit changed path ${path} has no completed journal pair`,
      );
    }
  }
  return {
    valid: failures.length === 0,
    operations: lines.length / 2,
    completedPaths: [...completedPaths].sort(),
    failures,
  };
}

function parseRecord(
  line: string | undefined,
  lineNumber: number,
  failures: RoutineFailure[],
): Record<string, unknown> | undefined {
  if (line === undefined) {
    invalid(
      failures,
      `line ${lineNumber} is missing from an intent/result pair`,
    );
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new TypeError("record must be an object");
    return value as Record<string, unknown>;
  } catch (error) {
    invalid(
      failures,
      `line ${lineNumber} is invalid JSONL: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function isIntent(
  record: Record<string, unknown>,
  line: number,
  failures: RoutineFailure[],
): record is Record<string, unknown> & {
  id: string;
  path: string;
  operation: string;
} {
  const keys = [
    "schemaVersion",
    "type",
    "id",
    "path",
    "operation",
    "plannedResult",
    "proofs",
  ];
  if (!exactKeys(record, keys)) {
    invalid(failures, `line ${line} does not have the exact intent fields`);
    return false;
  }
  if (
    record.schemaVersion !== WRITE_JOURNAL_SCHEMA_VERSION ||
    record.type !== "intent" ||
    !nonblank(record.id) ||
    !relativePath(record.path) ||
    typeof record.operation !== "string" ||
    !operations.has(record.operation) ||
    !nonblank(record.plannedResult) ||
    !validProofs(record.proofs)
  ) {
    invalid(failures, `line ${line} is not a valid schema-version-1 intent`);
    return false;
  }
  return true;
}

function isResult(
  record: Record<string, unknown>,
  line: number,
  failures: RoutineFailure[],
): record is Record<string, unknown> & {
  id: string;
  path: string;
  operation: string;
  outcome: string;
} {
  const keys = [
    "schemaVersion",
    "type",
    "id",
    "path",
    "operation",
    "outcome",
    "actual",
  ];
  if (!exactKeys(record, keys)) {
    invalid(failures, `line ${line} does not have the exact result fields`);
    return false;
  }
  if (
    record.schemaVersion !== WRITE_JOURNAL_SCHEMA_VERSION ||
    record.type !== "result" ||
    !nonblank(record.id) ||
    !relativePath(record.path) ||
    typeof record.operation !== "string" ||
    !operations.has(record.operation) ||
    typeof record.outcome !== "string" ||
    !outcomes.has(record.outcome) ||
    !nonblank(record.actual)
  ) {
    invalid(failures, `line ${line} is not a valid schema-version-1 result`);
    return false;
  }
  return true;
}

function validProofs(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const proofs = value as Record<string, unknown>;
  return (
    exactKeys(proofs, [...proofNames]) &&
    proofNames.every((name) => nonblank(proofs[name]))
  );
}

function relativePath(value: unknown): value is string {
  if (!nonblank(value) || value.includes("\\") || posix.isAbsolute(value))
    return false;
  const normalized = posix.normalize(value);
  return (
    normalized === value && normalized !== "." && !normalized.startsWith("../")
  );
}

function exactKeys(
  record: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual = Object.keys(record).sort();
  return (
    actual.length === expected.length &&
    expected.sort().every((key, index) => key === actual[index])
  );
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalid(failures: RoutineFailure[], detail: string): void {
  failures.push({
    code: "write-journal-invalid",
    message: `The session write journal is invalid: ${detail}.`,
  });
}
