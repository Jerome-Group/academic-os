import { readControlDocument } from "./control-document.js";
import { controlFinding, failedControl } from "./control-finding.js";
import { moduleControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";
import { isRecord, nonEmptyString } from "./value-shape.js";

const sourceMapPath = moduleControlPaths.sourceMap;
const unitKeys = ["topics", "lectures", "textbook", "tutorials"] as const;
// `topics` names ideas in the module's language; every other key holds module-relative paths.
const pathKeys = new Set<string>(unitKeys.filter((key) => key !== "topics"));

export function validateSourceMap(source: string | undefined): Finding {
  if (source === undefined) {
    return failedControl("MF-LEARNING-002", sourceMapPath, [
      `No readable control exists at ${sourceMapPath}.`,
    ]);
  }
  const parsed = readControlDocument(source);
  if ("problems" in parsed) {
    return failedControl("MF-LEARNING-002", sourceMapPath, parsed.problems);
  }
  const value = parsed.value;
  if (!isRecord(value) || !isRecord(value.units)) {
    return failedControl("MF-LEARNING-002", sourceMapPath, [
      "Source Map requires a units mapping, empty at seed.",
    ]);
  }
  const units = Object.entries(value.units);
  const problems = units.flatMap(([key, unit]) => unitProblems(key, unit));
  return problems.length === 0
    ? controlFinding(
        "MF-LEARNING-002",
        sourceMapPath,
        "pass",
        `Source Map declares ${units.length} Lecture-unit${units.length === 1 ? "" : "s"}.`,
        "Every declared unit carries the four sequences the workspace reads it for.",
      )
    : failedControl("MF-LEARNING-002", sourceMapPath, problems);
}

function unitProblems(key: string, unit: unknown): string[] {
  if (key.trim() === "") return ["A unit key is empty."];
  const unitName = `Unit ${JSON.stringify(key)}`;
  if (!isRecord(unit)) return [`${unitName} is not a mapping.`];
  return unitKeys.flatMap((unitKey) => {
    const entries = unit[unitKey];
    if (!Array.isArray(entries)) {
      return [`${unitName} requires ${unitKey} as a sequence.`];
    }
    return entries.flatMap((entry) => {
      if (!nonEmptyString(entry)) {
        return [`${unitName} has an empty ${unitKey} entry.`];
      }
      return pathKeys.has(unitKey) && !isModuleRelative(entry)
        ? [
            `${unitName} lists ${unitKey} entry ${JSON.stringify(entry)}, which is not module-relative.`,
          ]
        : [];
    });
  });
}

function isModuleRelative(path: string): boolean {
  return !path.startsWith("/") && !path.split("/").includes("..");
}
