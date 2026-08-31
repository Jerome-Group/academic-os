import { posix } from "node:path";

import { readControlDocument } from "../control-document.js";
import { researchEnforcementForRule } from "../research-rule-enforcement.js";
import type { ResearchFinding } from "../research-types.js";
import { isRecord, nonEmptyString } from "../value-shape.js";

export type ParsedRegister =
  | { root: Record<string, unknown>; rows: unknown[] }
  | { problems: string[] };

export function readRegister(
  source: string | undefined,
  path: string,
  rowsKey: string,
  optionalTopLevelKeys: readonly string[] = [],
): ParsedRegister {
  if (source === undefined) {
    return { problems: [`No readable control exists at ${path}.`] };
  }
  const parsed = readControlDocument(source);
  if ("problems" in parsed) return parsed;
  if (!isRecord(parsed.value)) {
    return { problems: [`${path} root is not a mapping.`] };
  }
  const allowed = new Set([rowsKey, ...optionalTopLevelKeys]);
  const extra = Object.keys(parsed.value).filter((key) => !allowed.has(key));
  const missing = !(rowsKey in parsed.value);
  const problems = [
    ...(missing ? [`${path} lacks ${rowsKey}.`] : []),
    ...(extra.length === 0
      ? []
      : [`${path} has unsupported top-level fields ${extra.join(", ")}.`]),
    ...(Array.isArray(parsed.value[rowsKey])
      ? []
      : [`${path} ${rowsKey} must be a sequence.`]),
  ];
  return problems.length === 0
    ? { root: parsed.value, rows: parsed.value[rowsKey] as unknown[] }
    : { problems };
}

export function registerRecords(
  source: string | undefined,
  path: string,
  rowsKey: string,
): Record<string, unknown>[] {
  const parsed = readRegister(source, path, rowsKey);
  return "problems" in parsed ? [] : parsed.rows.filter(isRecord);
}

export function registerStringField(
  source: string | undefined,
  path: string,
  rowsKey: string,
  field: string,
): Set<string> {
  return new Set(
    registerRecords(source, path, rowsKey).flatMap((row) =>
      nonEmptyString(row[field]) ? [row[field]] : [],
    ),
  );
}

export function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
  problems: string[],
): void {
  const allowedSet = new Set(allowed);
  const missing = required.filter((key) => !(key in value));
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (missing.length > 0)
    problems.push(`${label} lacks ${missing.join(", ")}.`);
  if (extra.length > 0) {
    problems.push(`${label} has unsupported fields ${extra.join(", ")}.`);
  }
}

export function requiredText(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
  problems: string[],
): void {
  for (const field of fields) {
    if (!nonEmptyString(value[field])) {
      problems.push(`${label} ${field} must be a non-empty string.`);
    }
  }
}

export function optionalText(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
  problems: string[],
  allowEmpty = false,
): void {
  for (const field of fields) {
    const candidate = value[field];
    if (
      candidate !== undefined &&
      (typeof candidate !== "string" ||
        (!allowEmpty && candidate.trim() === ""))
    ) {
      problems.push(
        `${label} ${field} must be ${allowEmpty ? "a string" : "a non-empty string"} when present.`,
      );
    }
  }
}

export function enumField(
  value: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  label: string,
  problems: string[],
): void {
  if (typeof value[field] !== "string" || !allowed.includes(value[field])) {
    problems.push(`${label} ${field} must be ${allowed.join(", ")}.`);
  }
}

export function stringArray(
  value: Record<string, unknown>,
  field: string,
  label: string,
  problems: string[],
): string[] {
  const candidate = value[field];
  if (!Array.isArray(candidate)) {
    problems.push(`${label} ${field} must be a sequence.`);
    return [];
  }
  const malformed = candidate.filter((entry) => !nonEmptyString(entry));
  if (malformed.length > 0) {
    problems.push(`${label} ${field} must contain only non-empty strings.`);
  }
  return candidate.filter(nonEmptyString);
}

export function checkRegisteredPointer(
  provenance: Record<string, unknown>,
  key: string,
  identities: ReadonlySet<string>,
  label: string,
  identityLabel: string,
  problems: string[],
): void {
  const pointer = provenance[key];
  if (nonEmptyString(pointer) && !identities.has(pointer)) {
    problems.push(
      `${label} provenance ${key} ${pointer} is not an existing ${identityLabel}.`,
    );
  }
}

export function isCalendarMilestoneIdentity(value: string): boolean {
  return /^Academic\/[^/\s]+$/u.test(value);
}

export function isProjectRelativePath(value: unknown): value is string {
  return (
    nonEmptyString(value) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    posix.normalize(value) === value &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function researchControlFinding(
  ruleId:
    | "RP-PROFILE-001"
    | "RP-PROFILE-003"
    | "RP-SOURCES-001"
    | "RP-SOURCES-002"
    | "RP-TASKS-001"
    | "RP-RESEARCH-001"
    | "RP-DELIVERABLES-001",
  problems: readonly string[],
  path: string,
  successEvidence: string,
  applicability: string,
): ResearchFinding {
  const status = problems.length === 0 ? "pass" : "fail";
  return {
    ruleId,
    enforcement: researchEnforcementForRule(ruleId),
    status,
    severity: status === "pass" ? "information" : "error",
    path,
    evidence: status === "pass" ? successEvidence : problems.join(" "),
    explanation: applicability,
    applicability,
  };
}
