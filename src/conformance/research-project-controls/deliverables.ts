import { researchProjectControlPaths } from "../research-project-control-paths.js";
import type {
  ResearchFinding,
  ResearchProjectProfile,
} from "../research-types.js";
import { isRecord, nonEmptyString } from "../value-shape.js";
import {
  enumField,
  exactKeys,
  isCalendarMilestoneIdentity,
  isProjectRelativePath,
  optionalText,
  readRegister,
  requiredText,
  researchControlFinding,
} from "./shared.js";

export function validateResearchProjectDeliverableRegister(
  source: string | undefined,
  profile: ResearchProjectProfile,
): ResearchFinding {
  const path = researchProjectControlPaths.deliverableRegister;
  const parsed = readRegister(source, path, "deliverables");
  if ("problems" in parsed) {
    return researchControlFinding(
      "RP-DELIVERABLES-001",
      parsed.problems,
      path,
      "Deliverable Register has the closed deliverables sequence.",
      "Deliverable rows use the selected profile's folder vocabulary.",
    );
  }
  const seenKeys = new Set<string>();
  const seenFolders = new Set<string>();
  const urecaFolders = new Set([
    "30 Deliverables/10 Abstract",
    "30 Deliverables/20 Poster",
    "30 Deliverables/30 Paper",
    "30 Deliverables/40 Reflection",
  ]);
  const problems = parsed.rows.flatMap((row, index) => {
    const position = index + 1;
    if (!isRecord(row)) return [`Deliverable ${position} is not a mapping.`];
    const rowProblems: string[] = [];
    exactKeys(
      row,
      ["key", "folder", "status", "authority", "milestone"],
      ["key", "folder", "status", "authority"],
      `Deliverable ${position}`,
      rowProblems,
    );
    requiredText(
      row,
      ["key", "folder", "authority"],
      `Deliverable ${position}`,
      rowProblems,
    );
    optionalText(row, ["milestone"], `Deliverable ${position}`, rowProblems);
    if (
      row.milestone !== undefined &&
      nonEmptyString(row.milestone) &&
      !isCalendarMilestoneIdentity(row.milestone)
    ) {
      rowProblems.push(
        `Deliverable ${position} milestone must be an Academic/<event-id> Live Calendar identity.`,
      );
    }
    enumField(
      row,
      "status",
      [
        "not-started",
        "working",
        "supervisor-review",
        "ready",
        "submitted",
        "accepted",
      ],
      `Deliverable ${position}`,
      rowProblems,
    );
    if (nonEmptyString(row.key)) {
      if (seenKeys.has(row.key)) {
        rowProblems.push(`Deliverable ${position} repeats key ${row.key}.`);
      }
      seenKeys.add(row.key);
    }
    if (nonEmptyString(row.folder)) {
      if (seenFolders.has(row.folder)) {
        rowProblems.push(
          `Deliverable ${position} repeats folder ${row.folder}.`,
        );
      }
      seenFolders.add(row.folder);
      if (
        !isProjectRelativePath(row.folder) ||
        !row.folder.startsWith("30 Deliverables/")
      ) {
        rowProblems.push(
          `Deliverable ${position} folder must be a normalized path beneath 30 Deliverables.`,
        );
      } else if (profile === "ureca" && !urecaFolders.has(row.folder)) {
        rowProblems.push(
          `Deliverable ${position} folder ${row.folder} is not derived by the ureca profile.`,
        );
      }
    }
    return rowProblems;
  });
  return researchControlFinding(
    "RP-DELIVERABLES-001",
    problems,
    path,
    `Deliverable Register declares ${parsed.rows.length} closed, typed ${profile} row${parsed.rows.length === 1 ? "" : "s"}.`,
    "Deliverable rows use the selected profile's folder vocabulary.",
  );
}
