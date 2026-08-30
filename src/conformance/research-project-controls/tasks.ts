import {
  researchTaskProvenanceKeys,
  taskStatuses,
} from "../../contract/task-register.js";
import { isDoDate } from "../../tasks/do-date.js";
import { researchProjectControlPaths } from "../research-project-control-paths.js";
import type {
  ResearchFinding,
  ResearchProjectInventory,
} from "../research-types.js";
import { isRecord, nonEmptyString } from "../value-shape.js";
import { claimStatuses, readMarkdownLedger } from "./ledgers.js";
import {
  checkRegisteredPointer,
  enumField,
  exactKeys,
  isCalendarMilestoneIdentity,
  isProjectRelativePath,
  optionalText,
  readRegister,
  registerRecords,
  registerStringField,
  researchControlFinding,
} from "./shared.js";

export function validateResearchProjectTaskRegister(
  source: string | undefined,
): ResearchFinding {
  const path = researchProjectControlPaths.taskRegister;
  const parsed = readRegister(source, path, "tasks", ["list_id"]);
  if ("problems" in parsed) {
    return researchControlFinding(
      "RP-TASKS-001",
      parsed.problems,
      path,
      "Task Register has the closed tasks sequence.",
      "Research-project tasks use the shared row and extended provenance vocabulary.",
    );
  }
  const listId = parsed.root.list_id;
  const problems = [
    ...(listId === undefined
      ? parsed.rows.length === 0
        ? []
        : ["Task Register holds tasks without naming the list they mirror."]
      : nonEmptyString(listId)
        ? []
        : ["Task Register list_id must be a non-empty string when present."]),
    ...parsed.rows.flatMap((row, index) =>
      researchTaskRowProblems(row, index + 1),
    ),
  ];
  return researchControlFinding(
    "RP-TASKS-001",
    problems,
    path,
    `Task Register declares ${parsed.rows.length} closed, typed task row${parsed.rows.length === 1 ? "" : "s"}.`,
    "Research-project tasks use the shared row and extended provenance vocabulary.",
  );
}

export function validateResearchProjectTaskProvenance(input: {
  taskRegister: string | undefined;
  sourceRegister: string | undefined;
  claims: string | undefined;
  deliverableRegister: string | undefined;
  inventory: ResearchProjectInventory;
}): ResearchFinding {
  const path = researchProjectControlPaths.taskRegister;
  const parsed = readRegister(input.taskRegister, path, "tasks", ["list_id"]);
  if ("problems" in parsed) {
    return researchControlFinding(
      "RP-TASKS-001",
      parsed.problems,
      path,
      "Every Research-task provenance pointer resolves to a registered control identity.",
      "Research-task provenance resolves only against identities the project controls register.",
    );
  }
  const sourceIds = registerStringField(
    input.sourceRegister,
    researchProjectControlPaths.sourceRegister,
    "sources",
    "id",
  );
  const claims = readMarkdownLedger(input.claims, "Claims", claimStatuses);
  const deliverables = registerRecords(
    input.deliverableRegister,
    researchProjectControlPaths.deliverableRegister,
    "deliverables",
  );
  const deliverableByKey = new Map(
    deliverables.flatMap((row) =>
      nonEmptyString(row.key) ? [[row.key, row] as const] : [],
    ),
  );
  const milestoneIdentities = new Set(
    deliverables.flatMap((row) =>
      nonEmptyString(row.milestone) &&
      isCalendarMilestoneIdentity(row.milestone)
        ? [row.milestone]
        : [],
    ),
  );
  const meetingPaths = new Set(
    input.inventory.entries
      .filter(
        ({ path: entryPath, kind }) =>
          kind === "file" &&
          entryPath.startsWith("20 Supervisor Meetings/") &&
          entryPath.endsWith(".md"),
      )
      .map(({ path: entryPath }) => entryPath),
  );
  const problems = parsed.rows.flatMap((row, index) => {
    if (!isRecord(row) || !isRecord(row.provenance)) return [];
    const position = index + 1;
    const provenance = row.provenance;
    const rowProblems: string[] = [];
    checkRegisteredPointer(
      provenance,
      "source",
      sourceIds,
      `Task ${position}`,
      "Source-register ID",
      rowProblems,
    );
    checkRegisteredPointer(
      provenance,
      "claim",
      claims.keys,
      `Task ${position}`,
      "Claim key",
      rowProblems,
    );
    checkRegisteredPointer(
      provenance,
      "deliverable",
      new Set(deliverableByKey.keys()),
      `Task ${position}`,
      "Deliverable-register key",
      rowProblems,
    );
    checkRegisteredPointer(
      provenance,
      "meeting",
      meetingPaths,
      `Task ${position}`,
      "inventoried meeting-note path",
      rowProblems,
    );
    if (nonEmptyString(provenance.milestone)) {
      if (!isCalendarMilestoneIdentity(provenance.milestone)) {
        rowProblems.push(
          `Task ${position} provenance milestone must be an Academic/<event-id> Live Calendar identity.`,
        );
      } else if (!milestoneIdentities.has(provenance.milestone)) {
        rowProblems.push(
          `Task ${position} provenance milestone ${provenance.milestone} is not declared by a Deliverable-register row.`,
        );
      }
      const deliverable = nonEmptyString(provenance.deliverable)
        ? deliverableByKey.get(provenance.deliverable)
        : undefined;
      if (
        deliverable !== undefined &&
        deliverable.milestone !== provenance.milestone
      ) {
        rowProblems.push(
          `Task ${position} provenance milestone does not match deliverable ${provenance.deliverable}.`,
        );
      }
    }
    return rowProblems;
  });
  return researchControlFinding(
    "RP-TASKS-001",
    problems,
    path,
    `Every Research-task provenance pointer resolves to a registered control identity (${parsed.rows.length.toString()} task row${parsed.rows.length === 1 ? "" : "s"} checked).`,
    "Research-task provenance resolves only against identities the project controls register.",
  );
}

function researchTaskRowProblems(row: unknown, position: number): string[] {
  if (!isRecord(row)) return [`Task ${position} is not a mapping.`];
  const problems: string[] = [];
  exactKeys(
    row,
    ["task_id", "title", "do_date", "status", "notes", "provenance"],
    ["title", "status"],
    `Task ${position}`,
    problems,
  );
  if (typeof row.title !== "string") {
    problems.push(`Task ${position} requires a title.`);
  }
  enumField(row, "status", taskStatuses, `Task ${position}`, problems);
  optionalText(row, ["task_id", "notes"], `Task ${position}`, problems, true);
  if (row.do_date !== undefined && !isDoDate(row.do_date)) {
    problems.push(
      `Task ${position} do_date must be a YYYY-MM-DD date with no time.`,
    );
  }
  if (row.provenance !== undefined) {
    if (!isRecord(row.provenance)) {
      problems.push(`Task ${position} provenance is not a mapping.`);
    } else {
      const supported = new Set<string>(researchTaskProvenanceKeys);
      const unsupported = Object.keys(row.provenance).filter(
        (key) => !supported.has(key),
      );
      if (unsupported.length > 0) {
        problems.push(
          `Task ${position} provenance has unsupported fields ${unsupported.join(", ")}.`,
        );
      }
      for (const key of researchTaskProvenanceKeys) {
        if (
          row.provenance[key] !== undefined &&
          !nonEmptyString(row.provenance[key])
        ) {
          problems.push(
            `Task ${position} provenance ${key} must be a non-empty string.`,
          );
        }
      }
      const meeting = row.provenance.meeting;
      if (
        meeting !== undefined &&
        (!isProjectRelativePath(meeting) ||
          !meeting.startsWith("20 Supervisor Meetings/") ||
          !meeting.endsWith(".md"))
      ) {
        problems.push(
          `Task ${position} provenance meeting must be a project-relative Markdown path beneath 20 Supervisor Meetings.`,
        );
      }
      const milestone = row.provenance.milestone;
      if (
        nonEmptyString(milestone) &&
        !isCalendarMilestoneIdentity(milestone)
      ) {
        problems.push(
          `Task ${position} provenance milestone must be an Academic/<event-id> Live Calendar identity.`,
        );
      }
    }
  }
  return problems;
}
