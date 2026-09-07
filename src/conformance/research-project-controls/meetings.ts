import { parseDocument } from "yaml";

import { researchProjectControlPaths } from "../research-project-control-paths.js";
import type {
  ResearchFinding,
  ResearchProjectInventory,
} from "../research-types.js";
import { isRecord, nonEmptyString } from "../value-shape.js";
import { researchControlFinding } from "./shared.js";
import {
  isMeetingExercisePath,
  isMeetingLearningPath,
  parseMeetingDirectory,
} from "./meeting-paths.js";

const meetingStatuses = [
  "scaffold",
  "planned",
  "draft",
  "confirmed",
  "cancelled",
  "rescheduled",
] as const;

const meetingChildren = [
  "Meeting.md",
  "Sources",
  "10 Learning",
  "20 Exercises",
] as const;

export function validateResearchProjectMeetings(input: {
  inventory: ResearchProjectInventory;
  schedule: string | undefined;
  meetingNotes: Readonly<Record<string, string>> | undefined;
}): ResearchFinding {
  const entries = new Map(
    input.inventory.entries.map((entry) => [entry.path, entry]),
  );
  const meetingDirectories = input.inventory.entries
    .filter(
      ({ path, kind }) =>
        kind === "directory" && /^20 Supervisor Meetings\/[^/]+$/u.test(path),
    )
    .map(({ path }) => path)
    .sort();
  const problems: string[] = [];
  const statusByDirectory = new Map<string, string>();

  const unexpected = input.inventory.entries.filter(
    ({ path }) =>
      /^20 Supervisor Meetings\/[^/]+$/u.test(path) &&
      path !== researchProjectControlPaths.schedule &&
      !meetingDirectories.includes(path),
  );
  if (unexpected.length > 0) {
    problems.push(
      `Supervisor Meetings has unsupported direct children ${unexpected.map(({ path }) => path).join(", ")}.`,
    );
  }

  for (const directory of meetingDirectories) {
    const identity = parseMeetingDirectory(directory);
    if (identity === undefined) {
      problems.push(
        `Meeting directory ${directory} must use a real YYYY-MM-DD date and a topic.`,
      );
      continue;
    }
    for (const child of meetingChildren) {
      const path = `${directory}/${child}`;
      const expectedKind = child === "Meeting.md" ? "file" : "directory";
      if (entries.get(path)?.kind !== expectedKind) {
        problems.push(`Meeting ${directory} requires ${expectedKind} ${path}.`);
      }
    }
    for (const area of ["10 Learning", "20 Exercises"] as const) {
      const areaRoot = `${directory}/${area}`;
      const records = `${directory}/${area}/records`;
      if (entries.get(records)?.kind !== "directory") {
        problems.push(`Meeting ${directory} requires directory ${records}.`);
      }
      const recordEntries = input.inventory.entries.filter(({ path }) =>
        path.startsWith(`${records}/`),
      );
      const activityEntries = input.inventory.entries.filter(({ path }) => {
        if (!path.startsWith(`${areaRoot}/`) || path === records) return false;
        return !path.slice(areaRoot.length + 1).includes("/");
      });
      const acceptsActivity =
        area === "10 Learning" ? isMeetingLearningPath : isMeetingExercisePath;
      for (const entry of activityEntries) {
        if (entry.kind !== "directory" || !acceptsActivity(entry.path)) {
          problems.push(
            `Meeting ${directory} ${area} activity ${entry.path} must be a direct NN Short title directory.`,
          );
        }
      }
      const sequences = new Set<string>();
      for (const entry of recordEntries) {
        const suffix = entry.path.slice(records.length + 1);
        const match = /^(\d{4})-[^/]+\.md$/u.exec(suffix);
        if (entry.kind !== "file" || match === null) {
          problems.push(
            `Meeting ${directory} record ${entry.path} must be a direct NNNN-slug.md file.`,
          );
          continue;
        }
        const sequence = match[1] ?? "";
        if (sequences.has(sequence)) {
          problems.push(
            `Meeting ${directory} ${area} repeats record sequence ${sequence}.`,
          );
        }
        sequences.add(sequence);
      }
    }
    const allowed = new Set(
      meetingChildren.map((child) => `${directory}/${child}`),
    );
    const directChildren = input.inventory.entries.filter(({ path }) => {
      if (!path.startsWith(`${directory}/`)) return false;
      return !path.slice(directory.length + 1).includes("/");
    });
    const extras = directChildren.filter(({ path }) => !allowed.has(path));
    if (extras.length > 0) {
      problems.push(
        `Meeting ${directory} has unsupported direct children ${extras.map(({ path }) => path).join(", ")}.`,
      );
    }
    const notePath = `${directory}/Meeting.md`;
    const note = input.meetingNotes?.[notePath];
    const noteResult = validateMeetingNote(note, identity.date, notePath);
    problems.push(...noteResult.problems);
    if (noteResult.status !== undefined)
      statusByDirectory.set(directory, noteResult.status);
  }

  problems.push(
    ...scheduleProblems(input.schedule, meetingDirectories, statusByDirectory),
  );
  return researchControlFinding(
    "RP-MEETINGS-001",
    problems,
    "20 Supervisor Meetings",
    `Supervisor Meetings declares ${meetingDirectories.length.toString()} dated meeting container${meetingDirectories.length === 1 ? "" : "s"} with matching notes and schedule rows.`,
    "Every supervisor meeting uses the dated container interface and appears once in the local schedule index.",
  );
}

function validateMeetingNote(
  source: string | undefined,
  expectedDate: string,
  path: string,
): { problems: string[]; status?: string } {
  if (source === undefined)
    return { problems: [`No readable meeting note exists at ${path}.`] };
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(source);
  if (match === null)
    return { problems: [`Meeting note ${path} requires YAML front matter.`] };
  let value: unknown;
  try {
    const document = parseDocument(match[1] ?? "");
    if (document.errors.length > 0) {
      return {
        problems: [`Meeting note ${path} front matter is not valid YAML.`],
      };
    }
    value = document.toJS();
  } catch {
    return {
      problems: [`Meeting note ${path} front matter is not valid YAML.`],
    };
  }
  if (!isRecord(value))
    return {
      problems: [`Meeting note ${path} front matter is not a mapping.`],
    };
  const problems: string[] = [];
  const expectedKeys = new Set(["date", "participants", "status"]);
  const missing = [...expectedKeys].filter((key) => !(key in value));
  const unsupported = Object.keys(value).filter(
    (key) => !expectedKeys.has(key),
  );
  if (missing.length > 0)
    problems.push(`Meeting note ${path} lacks ${missing.join(", ")}.`);
  if (unsupported.length > 0) {
    problems.push(
      `Meeting note ${path} has unsupported front-matter fields ${unsupported.join(", ")}.`,
    );
  }
  if (value.date !== expectedDate) {
    problems.push(`Meeting note ${path} date must be ${expectedDate}.`);
  }
  if (
    !Array.isArray(value.participants) ||
    value.participants.length === 0 ||
    value.participants.some((participant) => !nonEmptyString(participant))
  ) {
    problems.push(
      `Meeting note ${path} participants must be a sequence of non-empty names.`,
    );
  }
  if (!(meetingStatuses as readonly unknown[]).includes(value.status)) {
    problems.push(
      `Meeting note ${path} status must be ${meetingStatuses.join(", ")}.`,
    );
  }
  return {
    problems,
    ...(typeof value.status === "string" &&
    meetingStatuses.includes(value.status as (typeof meetingStatuses)[number])
      ? { status: value.status }
      : {}),
  };
}

function scheduleProblems(
  source: string | undefined,
  meetingDirectories: readonly string[],
  statusByDirectory: ReadonlyMap<string, string>,
): string[] {
  if (source === undefined) {
    return [
      `No readable schedule exists at ${researchProjectControlPaths.schedule}.`,
    ];
  }
  const problems: string[] = [];
  const tableLines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (tableLines[0] !== "| Date | Folder | State |") {
    problems.push(
      "Schedule requires the exact Date | Folder | State table header.",
    );
  }
  if (
    !/^\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|$/u.test(
      tableLines[1] ?? "",
    )
  ) {
    problems.push("Schedule requires a three-column table separator.");
  }
  const rows = tableLines.slice(2).flatMap((line, index) => {
    const match =
      /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|$/u.exec(
        line,
      );
    if (match === null) {
      problems.push(
        `Schedule row ${index + 1} does not use date, full backticked folder path and state.`,
      );
      return [];
    }
    return [
      {
        date: match[1] ?? "",
        path: (match[2] ?? "").replace(/\/$/u, ""),
        status: (match[3] ?? "").trim(),
      },
    ];
  });
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.path))
      problems.push(`Schedule repeats meeting path ${row.path}.`);
    seen.add(row.path);
    const identity = parseMeetingDirectory(row.path);
    if (identity === undefined || identity.date !== row.date) {
      problems.push(
        `Schedule path ${row.path} must be a full dated meeting directory matching ${row.date}.`,
      );
    }
    if (!meetingDirectories.includes(row.path)) {
      problems.push(
        `Schedule path ${row.path} does not identify an inventoried meeting directory.`,
      );
    }
    const noteStatus = statusByDirectory.get(row.path);
    if (noteStatus !== undefined && row.status !== noteStatus) {
      problems.push(
        `Schedule status ${row.status} for ${row.path} must match Meeting.md status ${noteStatus}.`,
      );
    }
  }
  for (const directory of meetingDirectories) {
    if (!seen.has(directory))
      problems.push(`Schedule omits meeting directory ${directory}.`);
  }
  return problems;
}
