import { taskProvenanceKeys, taskStatuses } from "../contract/task-register.js";
import { isDoDate } from "../tasks/do-date.js";
import { readControlDocument } from "./control-document.js";
import { controlFinding, failedControl } from "./control-finding.js";
import { moduleControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";
import { citesImporterInterior } from "../contract/importer-citations.js";
import { isRecord, nonEmptyString } from "./value-shape.js";

const registerPath = moduleControlPaths.taskRegister;
const statuses = new Set<string>(taskStatuses);

export function validateTaskRegister(
  source: string | undefined,
  importerRoots: readonly string[] = ["NTULearn"],
): Finding {
  if (source === undefined) {
    return failedControl("MF-TASKS-001", registerPath, [
      `No readable control exists at ${registerPath}.`,
    ]);
  }
  const parsed = readControlDocument(source);
  if ("problems" in parsed) {
    return failedControl("MF-TASKS-001", registerPath, parsed.problems);
  }
  const value = parsed.value;
  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    return failedControl("MF-TASKS-001", registerPath, [
      "Task register requires a tasks sequence, empty at seed.",
    ]);
  }
  const rows = value.tasks;
  // A header written out and left blank says what an absent one says, and the store the CLI reads
  // through takes it the same way.
  const listId = value.list_id ?? undefined;
  const problems = [
    ...listIdProblems(listId, rows.length),
    ...rows.flatMap((row, index) => rowProblems(row, index + 1, importerRoots)),
  ];
  return problems.length === 0
    ? controlFinding(
        "MF-TASKS-001",
        registerPath,
        "pass",
        `Task register mirrors ${rows.length} task${rows.length === 1 ? "" : "s"} of ${listIdEvidence(listId)}.`,
        "The register carries the mirrored fields and the provenance the live list cannot.",
      )
    : failedControl("MF-TASKS-001", registerPath, problems);
}

// One row means the list exists, and the exact ID that row was mirrored from is the register's
// only route back to it.
function listIdProblems(listId: unknown, rows: number): string[] {
  if (listId === undefined) {
    return rows === 0
      ? []
      : ["Task register holds tasks without naming the list they mirror."];
  }
  return nonEmptyString(listId)
    ? []
    : ["Task register list_id must be a non-empty string when present."];
}

function listIdEvidence(listId: unknown): string {
  return nonEmptyString(listId)
    ? `list ${listId}`
    : "a list provisioning has yet to name";
}

function rowProblems(
  row: unknown,
  position: number,
  importerRoots: readonly string[],
): string[] {
  if (!isRecord(row)) return [`Task ${position} is not a mapping.`];
  const problems: string[] = [];
  // The register mirrors the live list, so an empty title is Google's to fix and never the
  // module's: the row has to carry the key, and what the key holds is the list's business.
  if (typeof row.title !== "string") {
    problems.push(`Task ${position} requires a title.`);
  }
  if (typeof row.status !== "string" || !statuses.has(row.status)) {
    problems.push(
      `Task ${position} status ${JSON.stringify(row.status)} is not open, completed, or cancelled.`,
    );
  }
  problems.push(...doDateProblems(row.do_date, position));
  for (const key of ["task_id", "notes"]) {
    if (row[key] !== undefined && typeof row[key] !== "string") {
      problems.push(`Task ${position} ${key} must be a string when present.`);
    }
  }
  if (row.provenance !== undefined) {
    problems.push(
      ...provenanceProblems(row.provenance, position, importerRoots),
    );
  }
  return problems;
}

// The schema reserves no room for a time of day, so a register carrying one is reported as the
// deadline somebody meant rather than quietly read as the date it starts with.
function doDateProblems(doDate: unknown, position: number): string[] {
  if (doDate === undefined || isDoDate(doDate)) return [];
  return typeof doDate === "string" && /^\d{4}-\d{2}-\d{2}./u.test(doDate)
    ? [
        `Task ${position} do_date ${JSON.stringify(doDate)} carries a time of day; a do-date is a date alone.`,
      ]
    : [
        `Task ${position} do_date ${JSON.stringify(doDate)} is not a YYYY-MM-DD date.`,
      ];
}

function provenanceProblems(
  provenance: unknown,
  position: number,
  importerRoots: readonly string[],
): string[] {
  if (!isRecord(provenance)) {
    return [`Task ${position} provenance is not a mapping.`];
  }
  const problems = taskProvenanceKeys.flatMap((key) =>
    provenance[key] === undefined || nonEmptyString(provenance[key])
      ? []
      : [`Task ${position} provenance ${key} must be a non-empty string.`],
  );
  const source = provenance.source;
  if (nonEmptyString(source)) {
    if (citesImporterInterior(source, importerRoots)) {
      problems.push(
        `Task ${position} provenance source walks into the importer's interior; cite the file name ${source.split("/").at(-1)}.`,
      );
    }
  }
  return problems;
}
