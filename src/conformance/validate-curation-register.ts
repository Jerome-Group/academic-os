import {
  controlFinding,
  failedControl,
  isRecord,
  nonEmptyString,
} from "./control-finding.js";
import { moduleControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";

const registerPath = moduleControlPaths.curationRegister;
const decisions = new Set(["curated", "source-only", "requires-decision"]);

export function validateCurationRegister(source: string | undefined): Finding {
  if (source === undefined) {
    return failedControl("MF-CURATION-001", registerPath, [
      `No readable control exists at ${registerPath}.`,
    ]);
  }
  if (source === "") {
    return controlFinding(
      "MF-CURATION-001",
      registerPath,
      "pass",
      "Curation Register is the valid empty seed file.",
      "An empty register contains no malformed events.",
    );
  }
  const problems: string[] = [];
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") {
      problems.push(`Line ${lineNumber} is blank.`);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      problems.push(
        `Line ${lineNumber} is not JSON: ${error instanceof Error ? error.message : String(error)}.`,
      );
      continue;
    }
    problems.push(...validateEvent(value, lineNumber));
  }
  return problems.length === 0
    ? controlFinding(
        "MF-CURATION-001",
        registerPath,
        "pass",
        `Curation Register contains ${lines.length} structurally valid event${lines.length === 1 ? "" : "s"}.`,
        "Every non-empty line is one supported curation-decision event.",
      )
    : failedControl("MF-CURATION-001", registerPath, problems);
}

function validateEvent(value: unknown, line: number): string[] {
  if (!isRecord(value)) return [`Line ${line} is not a JSON object.`];
  const problems: string[] = [];
  const requiredStrings = [
    "source_id",
    "integration",
    "role",
    "source_path",
    "evidence",
    "timestamp",
  ];
  if (value.schema_version !== 1) {
    problems.push(
      `Line ${line} has unsupported schema_version ${JSON.stringify(value.schema_version)}; supported version is 1.`,
    );
  }
  for (const field of requiredStrings) {
    if (!nonEmptyString(value[field])) {
      problems.push(`Line ${line} requires non-empty ${field}.`);
    }
  }
  if (
    nonEmptyString(value.source_path) &&
    (value.source_path.startsWith("/") ||
      value.source_path.split("/").includes(".."))
  ) {
    problems.push(`Line ${line} source_path must be source-relative.`);
  }
  if (value.checksum !== undefined && !nonEmptyString(value.checksum)) {
    problems.push(`Line ${line} checksum must be non-empty when present.`);
  }
  if (!nonEmptyString(value.decision) || !decisions.has(value.decision)) {
    problems.push(
      `Line ${line} decision is not curated, source-only, or requires-decision.`,
    );
  }
  if (value.decision === "curated" && !nonEmptyString(value.destination)) {
    problems.push(`Line ${line} curated decision requires destination.`);
  }
  if (value.decision !== "curated" && value.destination !== undefined) {
    problems.push(
      `Line ${line} destination is allowed only for curated decisions.`,
    );
  }
  if (value.destination !== undefined && !nonEmptyString(value.destination)) {
    problems.push(
      `Line ${line} destination must be a non-empty string when present.`,
    );
  }
  if (
    nonEmptyString(value.destination) &&
    (value.destination.startsWith("/") ||
      value.destination.split("/").includes(".."))
  ) {
    problems.push(`Line ${line} destination must be module-relative.`);
  }
  if (
    nonEmptyString(value.timestamp) &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value.timestamp,
    ) ||
      Number.isNaN(Date.parse(value.timestamp)))
  ) {
    problems.push(`Line ${line} timestamp is not an ISO 8601 instant.`);
  }
  if (value.supersedes !== undefined && !nonEmptyString(value.supersedes)) {
    problems.push(`Line ${line} supersedes must be non-empty when present.`);
  }
  return problems;
}
