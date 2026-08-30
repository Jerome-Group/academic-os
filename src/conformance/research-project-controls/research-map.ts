import { researchProjectControlPaths } from "../research-project-control-paths.js";
import type {
  ResearchFinding,
  ResearchProjectInventory,
} from "../research-types.js";
import { isRecord, nonEmptyString } from "../value-shape.js";
import {
  enumField,
  exactKeys,
  isProjectRelativePath,
  readRegister,
  registerStringField,
  requiredText,
  researchControlFinding,
  stringArray,
} from "./shared.js";

export function validateResearchProjectMap(input: {
  source: string | undefined;
  sourceRegister: string | undefined;
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
      "Each Research-map thread uses durable pointers rather than prose or task state.",
    );
  }
  const sourceIds = registerStringField(
    input.sourceRegister,
    researchProjectControlPaths.sourceRegister,
    "sources",
    "id",
  );
  const inventoryEntries = new Map(
    input.inventory.entries.map((entry) => [entry.path, entry]),
  );
  const seen = new Set<string>();
  const problems = parsed.rows.flatMap((row, index) => {
    const position = index + 1;
    if (!isRecord(row)) return [`Thread ${position} is not a mapping.`];
    const rowProblems: string[] = [];
    exactKeys(
      row,
      [
        "key",
        "title",
        "status",
        "sources",
        "reading",
        "mathematics",
        "experiments",
      ],
      [
        "key",
        "title",
        "status",
        "sources",
        "reading",
        "mathematics",
        "experiments",
      ],
      `Thread ${position}`,
      rowProblems,
    );
    requiredText(row, ["key", "title"], `Thread ${position}`, rowProblems);
    enumField(
      row,
      "status",
      ["open", "parked", "closed"],
      `Thread ${position}`,
      rowProblems,
    );
    if (nonEmptyString(row.key)) {
      if (seen.has(row.key)) {
        rowProblems.push(`Thread ${position} repeats key ${row.key}.`);
      }
      seen.add(row.key);
    }
    const sources = stringArray(
      row,
      "sources",
      `Thread ${position}`,
      rowProblems,
    );
    for (const source of sources) {
      if (!sourceIds.has(source)) {
        rowProblems.push(
          `Thread ${position} sources pointer ${JSON.stringify(source)} is not an existing Source-register ID.`,
        );
      }
    }
    for (const [field, prefix] of [
      ["reading", "70 Research/10 Reading/"],
      ["mathematics", "70 Research/20 Mathematics/"],
      ["experiments", "70 Research/30 Experiments/"],
    ] as const) {
      const values = stringArray(row, field, `Thread ${position}`, rowProblems);
      for (const pointer of values) {
        const validPath =
          isProjectRelativePath(pointer) && pointer.startsWith(prefix);
        if (!validPath) {
          rowProblems.push(
            `Thread ${position} ${field} pointer ${JSON.stringify(pointer)} must be a normalized path under ${prefix}.`,
          );
        } else if (inventoryEntries.get(pointer)?.kind !== "file") {
          rowProblems.push(
            `Thread ${position} ${field} pointer ${JSON.stringify(pointer)} does not identify an inventoried file.`,
          );
        }
      }
    }
    return rowProblems;
  });
  return researchControlFinding(
    "RP-RESEARCH-001",
    problems,
    path,
    `Research Map declares ${parsed.rows.length} closed, typed thread row${parsed.rows.length === 1 ? "" : "s"}.`,
    "Each Research-map thread uses durable pointers rather than prose or task state.",
  );
}
