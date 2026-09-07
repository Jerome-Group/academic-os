import { researchProjectControlPaths } from "../research-project-control-paths.js";
import type {
  ResearchFinding,
  ResearchProjectInventory,
} from "../research-types.js";
import { isRecord, nonEmptyString } from "../value-shape.js";
import { questionStatuses, readMarkdownLedger } from "./ledgers.js";
import {
  isMeetingExercisePath,
  isMeetingLearningPath,
  isMeetingNotePath,
  isMeetingRecordPath,
} from "./meeting-paths.js";
import {
  enumField,
  exactKeys,
  isProjectRelativePath,
  optionalText,
  readRegister,
  registerStringField,
  requiredText,
  researchControlFinding,
  stringArray,
} from "./shared.js";

export function validateResearchProjectMap(input: {
  source: string | undefined;
  sourceRegister: string | undefined;
  questions: string | undefined;
  inventory: ResearchProjectInventory;
}): ResearchFinding {
  const path = researchProjectControlPaths.researchMap;
  const parsed = readRegister(input.source, path, "threads");
  if ("problems" in parsed) {
    return researchControlFinding(
      "RP-RESEARCH-001",
      parsed.problems,
      path,
      "Research Map has the closed threads sequence.",
      "Each Research-map thread joins a stable Question to meeting work and optional promoted outputs.",
    );
  }
  const sourceIds = registerStringField(
    input.sourceRegister,
    researchProjectControlPaths.sourceRegister,
    "sources",
    "id",
  );
  const questionIds = readMarkdownLedger(
    input.questions,
    "Questions",
    questionStatuses,
  ).keys;
  const inventoryEntries = new Map(
    input.inventory.entries.map((entry) => [entry.path, entry]),
  );
  const seenKeys = new Set<string>();
  const seenOrders = new Set<number>();
  const problems = parsed.rows.flatMap((row, index) => {
    const position = index + 1;
    if (!isRecord(row)) return [`Thread ${position} is not a mapping.`];
    const rowProblems: string[] = [];
    exactKeys(
      row,
      [
        "key",
        "order",
        "title",
        "question",
        "status",
        "progress",
        "sources",
        "meeting_work",
        "promoted",
      ],
      [
        "key",
        "order",
        "title",
        "question",
        "status",
        "sources",
        "meeting_work",
        "promoted",
      ],
      `Thread ${position}`,
      rowProblems,
    );
    requiredText(
      row,
      ["key", "title", "question"],
      `Thread ${position}`,
      rowProblems,
    );
    optionalText(row, ["progress"], `Thread ${position}`, rowProblems);
    enumField(
      row,
      "status",
      ["open", "parked", "closed"],
      `Thread ${position}`,
      rowProblems,
    );
    validateIdentity(
      row,
      position,
      seenKeys,
      seenOrders,
      questionIds,
      rowProblems,
    );
    validateSources(row, position, sourceIds, rowProblems);
    validateMeetingWork(row, position, inventoryEntries, rowProblems);
    validatePromoted(row, position, inventoryEntries, rowProblems);
    return rowProblems;
  });
  return researchControlFinding(
    "RP-RESEARCH-001",
    problems,
    path,
    `Research Map declares ${parsed.rows.length} stable meeting-centred thread row${parsed.rows.length === 1 ? "" : "s"}.`,
    "Each Research-map thread joins a stable Question to meeting work and optional promoted outputs.",
  );
}

function validateIdentity(
  row: Record<string, unknown>,
  position: number,
  seenKeys: Set<string>,
  seenOrders: Set<number>,
  questionIds: ReadonlySet<string>,
  problems: string[],
): void {
  if (nonEmptyString(row.key)) {
    if (seenKeys.has(row.key))
      problems.push(`Thread ${position} repeats key ${row.key}.`);
    seenKeys.add(row.key);
  }
  if (!Number.isSafeInteger(row.order) || (row.order as number) < 1) {
    problems.push(`Thread ${position} order must be a positive integer.`);
  } else {
    const order = row.order as number;
    if (seenOrders.has(order))
      problems.push(`Thread ${position} repeats order ${order}.`);
    seenOrders.add(order);
  }
  if (nonEmptyString(row.question) && !questionIds.has(row.question)) {
    problems.push(
      `Thread ${position} question ${row.question} is not an existing Questions-ledger key.`,
    );
  }
}

function validateSources(
  row: Record<string, unknown>,
  position: number,
  sourceIds: ReadonlySet<string>,
  problems: string[],
): void {
  for (const source of stringArray(
    row,
    "sources",
    `Thread ${position}`,
    problems,
  )) {
    if (!sourceIds.has(source)) {
      problems.push(
        `Thread ${position} sources pointer ${JSON.stringify(source)} is not an existing Source-register ID.`,
      );
    }
  }
}

function validateMeetingWork(
  row: Record<string, unknown>,
  position: number,
  inventory: ReadonlyMap<string, { kind: string }>,
  problems: string[],
): void {
  if (!Array.isArray(row.meeting_work)) {
    problems.push(`Thread ${position} meeting_work must be a sequence.`);
    return;
  }
  const seenMeetings = new Set<string>();
  for (const [index, work] of row.meeting_work.entries()) {
    const label = `Thread ${position} meeting work ${index + 1}`;
    if (!isRecord(work)) {
      problems.push(`${label} is not a mapping.`);
      continue;
    }
    exactKeys(
      work,
      [
        "meeting",
        "status",
        "progress",
        "learning_units",
        "exercise_sets",
        "session_records",
      ],
      [
        "meeting",
        "status",
        "learning_units",
        "exercise_sets",
        "session_records",
      ],
      label,
      problems,
    );
    requiredText(work, ["meeting"], label, problems);
    optionalText(work, ["progress"], label, problems);
    enumField(
      work,
      "status",
      ["planned", "active", "discussed", "settled", "cancelled"],
      label,
      problems,
    );
    if (nonEmptyString(work.meeting)) {
      if (
        !isProjectRelativePath(work.meeting) ||
        !isMeetingNotePath(work.meeting)
      ) {
        problems.push(`${label} meeting must be a dated Meeting.md path.`);
      } else if (inventory.get(work.meeting)?.kind !== "file") {
        problems.push(
          `${label} meeting ${work.meeting} does not identify an inventoried file.`,
        );
      }
      if (seenMeetings.has(work.meeting))
        problems.push(`${label} repeats meeting ${work.meeting}.`);
      seenMeetings.add(work.meeting);
    }
    validatePointers(
      work,
      "learning_units",
      label,
      isMeetingLearningPath,
      "directory",
      inventory,
      problems,
    );
    validatePointers(
      work,
      "exercise_sets",
      label,
      isMeetingExercisePath,
      "directory",
      inventory,
      problems,
    );
    validatePointers(
      work,
      "session_records",
      label,
      isMeetingRecordPath,
      "file",
      inventory,
      problems,
    );
  }
}

function validatePromoted(
  row: Record<string, unknown>,
  position: number,
  inventory: ReadonlyMap<string, { kind: string }>,
  problems: string[],
): void {
  const label = `Thread ${position} promoted`;
  if (!isRecord(row.promoted)) {
    problems.push(`${label} must be a mapping.`);
    return;
  }
  exactKeys(
    row.promoted,
    ["concepts", "research_notes"],
    ["concepts", "research_notes"],
    label,
    problems,
  );
  validatePointers(
    row.promoted,
    "concepts",
    label,
    (path) =>
      nonEmptyString(row.key) &&
      path.startsWith(`70 Research/10 Concepts/${row.key}/`),
    "file",
    inventory,
    problems,
  );
  validatePointers(
    row.promoted,
    "research_notes",
    label,
    (path) =>
      nonEmptyString(row.key) &&
      path.startsWith(`70 Research/20 Research Notes/${row.key}/`),
    "file",
    inventory,
    problems,
  );
}

function validatePointers(
  value: Record<string, unknown>,
  field: string,
  label: string,
  acceptsPath: (path: string) => boolean,
  expectedKind: "file" | "directory",
  inventory: ReadonlyMap<string, { kind: string }>,
  problems: string[],
): void {
  const seen = new Set<string>();
  for (const pointer of stringArray(value, field, label, problems)) {
    if (!isProjectRelativePath(pointer) || !acceptsPath(pointer)) {
      problems.push(
        `${label} ${field} pointer ${JSON.stringify(pointer)} has the wrong project home.`,
      );
    } else if (inventory.get(pointer)?.kind !== expectedKind) {
      problems.push(
        `${label} ${field} pointer ${JSON.stringify(pointer)} does not identify an inventoried ${expectedKind}.`,
      );
    }
    if (seen.has(pointer))
      problems.push(`${label} ${field} repeats pointer ${pointer}.`);
    seen.add(pointer);
  }
}
