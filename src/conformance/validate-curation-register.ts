import { controlFinding, failedControl } from "./control-finding.js";
import { moduleControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";
import { isRecord, nonEmptyString } from "./value-shape.js";

const registerPath = moduleControlPaths.curationRegister;
// Version 2 adds `rederived`, whose line names the derived artifacts an item's content reached the
// module through. A version 1 line stays valid history exactly as it was written, so one file
// holding both versions is one file holding its own past.
const version1Decisions = ["curated", "source-only", "requires-decision"];
const version2Decisions = [...version1Decisions, "rederived"];
const decisionsByVersion = new Map([
  [1, version1Decisions],
  [2, version2Decisions],
]);
const supportedVersions = [...decisionsByVersion.keys()];

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
  const declared = readDecisions(value.schema_version);
  if (declared === undefined) {
    problems.push(
      `Line ${line} has unsupported schema_version ${JSON.stringify(value.schema_version)}; supported versions are ${supportedVersions.join(" and ")}.`,
    );
  }
  // A line whose version says nothing is still read for its decision, against the newest
  // vocabulary — so an unsupported version reports what else is wrong with the line beside it.
  const decisions = declared ?? version2Decisions;
  for (const field of requiredStrings) {
    if (!nonEmptyString(value[field])) {
      problems.push(`Line ${line} requires non-empty ${field}.`);
    }
  }
  if (nonEmptyString(value.source_path) && !isRelative(value.source_path)) {
    problems.push(`Line ${line} source_path must be source-relative.`);
  }
  if (value.checksum !== undefined && !nonEmptyString(value.checksum)) {
    problems.push(`Line ${line} checksum must be non-empty when present.`);
  }
  if (!nonEmptyString(value.decision) || !decisions.includes(value.decision)) {
    problems.push(
      `Line ${line} decision is not one of ${decisions.join(", ")}.`,
    );
  }
  problems.push(...outcomeProblems(value, line));
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

// Where the item's content went: a curated line names the copy's destination, a rederived line
// names every artifact the content reached instead, and the two are never the same line.
function outcomeProblems(
  value: Record<string, unknown>,
  line: number,
): string[] {
  const problems: string[] = [];
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
  if (nonEmptyString(value.destination) && !isRelative(value.destination)) {
    problems.push(`Line ${line} destination must be module-relative.`);
  }
  if (value.decision === "rederived") {
    problems.push(...derivedProblems(value.derived, line));
  } else if (value.derived !== undefined) {
    problems.push(
      `Line ${line} derived is allowed only for rederived decisions.`,
    );
  }
  return problems;
}

function derivedProblems(derived: unknown, line: number): string[] {
  if (!Array.isArray(derived) || derived.length === 0) {
    return [
      `Line ${line} rederived decision requires a non-empty derived list.`,
    ];
  }
  return derived.flatMap((path) => {
    if (!nonEmptyString(path)) {
      return [`Line ${line} derived must hold non-empty paths.`];
    }
    return isRelative(path)
      ? []
      : [
          `Line ${line} derived path ${JSON.stringify(path)} must be module-relative.`,
        ];
  });
}

function readDecisions(schemaVersion: unknown): string[] | undefined {
  return typeof schemaVersion === "number"
    ? decisionsByVersion.get(schemaVersion)
    : undefined;
}

// A path a register line records stays inside the tree it is written against — the importer root
// for a source, the module folder for everything the decision produced.
function isRelative(path: string): boolean {
  return !path.startsWith("/") && !path.split("/").includes("..");
}
