import { researchProjectControlPaths } from "../research-project-control-paths.js";
import type {
  ResearchFinding,
  ResearchProjectInventory,
  ResearchProjectProfile,
} from "../research-types.js";
import { isRecord, nonEmptyString } from "../value-shape.js";
import {
  enumField,
  exactKeys,
  isProjectRelativePath,
  optionalText,
  readRegister,
  requiredText,
  researchControlFinding,
} from "./shared.js";

export function validateResearchProjectSourceRegister(
  source: string | undefined,
): ResearchFinding {
  const path = researchProjectControlPaths.sourceRegister;
  const parsed = readRegister(source, path, "sources");
  if ("problems" in parsed) {
    return researchControlFinding(
      "RP-SOURCES-001",
      parsed.problems,
      path,
      "Source Register has the closed sources sequence.",
      "Every Source-register row uses the contract vocabulary.",
    );
  }
  const seen = new Set<string>();
  const problems = parsed.rows.flatMap((row, index) => {
    const position = index + 1;
    if (!isRecord(row)) return [`Source ${position} is not a mapping.`];
    const rowProblems: string[] = [];
    exactKeys(
      row,
      [
        "id",
        "title",
        "authority",
        "role",
        "locator",
        "local_file",
        "citation_key",
        "status",
        "evidence",
      ],
      ["id", "title", "authority", "role", "locator", "status", "evidence"],
      `Source ${position}`,
      rowProblems,
    );
    requiredText(
      row,
      ["id", "title", "locator", "evidence"],
      `Source ${position}`,
      rowProblems,
    );
    enumField(
      row,
      "authority",
      ["primary", "secondary", "generated"],
      `Source ${position}`,
      rowProblems,
    );
    enumField(
      row,
      "role",
      ["programme", "project", "core", "reference", "historical"],
      `Source ${position}`,
      rowProblems,
    );
    enumField(
      row,
      "status",
      ["queued", "reading", "read", "retired"],
      `Source ${position}`,
      rowProblems,
    );
    optionalText(
      row,
      ["local_file", "citation_key"],
      `Source ${position}`,
      rowProblems,
    );
    if (nonEmptyString(row.id)) {
      if (seen.has(row.id)) {
        rowProblems.push(`Source ${position} repeats id ${row.id}.`);
      }
      seen.add(row.id);
    }
    if (
      row.local_file !== undefined &&
      !isProjectRelativePath(row.local_file)
    ) {
      rowProblems.push(
        `Source ${position} local_file must be a normalized project-relative path.`,
      );
    }
    if (
      (row.role === "core" || row.role === "reference") &&
      !nonEmptyString(row.citation_key)
    ) {
      rowProblems.push(
        `Source ${position} role ${row.role} requires citation_key.`,
      );
    }
    return rowProblems;
  });
  return researchControlFinding(
    "RP-SOURCES-001",
    problems,
    path,
    `Source Register declares ${parsed.rows.length} closed, typed source row${parsed.rows.length === 1 ? "" : "s"}.`,
    "Every Source-register row uses the contract vocabulary.",
  );
}

export function validateResearchProjectSourcePlacement(input: {
  source: string | undefined;
  inventory: ResearchProjectInventory;
  profile: ResearchProjectProfile;
}): ResearchFinding {
  const path = researchProjectControlPaths.sourceRegister;
  const parsed = readRegister(input.source, path, "sources");
  if ("problems" in parsed) {
    return researchControlFinding(
      "RP-SOURCES-002",
      parsed.problems,
      path,
      "Every registered local source exists in its authority and role home.",
      "Local source placement applies to each Source-register row with local_file.",
    );
  }
  const entries = new Map(
    input.inventory.entries.map((entry) => [entry.path, entry]),
  );
  const problems = parsed.rows.flatMap((row, index) => {
    if (!isRecord(row) || row.local_file === undefined) return [];
    const position = index + 1;
    const localFile = row.local_file;
    if (!isProjectRelativePath(localFile)) {
      return [
        `Source ${position} local_file must be a normalized project-relative path before placement can be checked.`,
      ];
    }
    const entry = entries.get(localFile);
    const rowProblems: string[] = [];
    if (entry?.kind !== "file") {
      rowProblems.push(
        `Source ${position} local_file ${localFile} does not identify an inventoried file.`,
      );
    }
    const homes = sourceHomes(row, input.profile);
    if (homes.length === 0) {
      rowProblems.push(
        `Source ${position} has no valid placement because its authority or role is unsupported.`,
      );
    } else if (!homes.some((home) => isBeneath(localFile, home))) {
      rowProblems.push(
        `Source ${position} local_file ${localFile} must be beneath ${homes.join(" or ")}.`,
      );
    }
    return rowProblems;
  });
  return researchControlFinding(
    "RP-SOURCES-002",
    problems,
    path,
    `Every registered local source exists in its authority and role home (${parsed.rows.length.toString()} source row${parsed.rows.length === 1 ? "" : "s"} checked).`,
    "Local source placement applies to each Source-register row with local_file.",
  );
}

function sourceHomes(
  row: Record<string, unknown>,
  profile: ResearchProjectProfile,
): string[] {
  if (row.authority === "generated") {
    return [
      ...(profile === "ureca" ? ["90 Resources/20 Research Aids"] : []),
      "90 Resources/00 Unclassified",
    ];
  }
  switch (row.role) {
    case "programme":
    case "project":
      return ["10 Source Materials/10 Programme and Project"];
    case "core":
      return ["10 Source Materials/20 Core Sources"];
    case "reference":
      return ["10 Source Materials/30 Reference Sources"];
    case "historical":
      return [
        profile === "ureca"
          ? "90 Resources/10 Preparation Archive"
          : "90 Resources/00 Unclassified",
      ];
    default:
      return [];
  }
}

function isBeneath(path: string, home: string): boolean {
  return path.startsWith(`${home}/`) && path.length > home.length + 1;
}
