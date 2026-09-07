import { readControlDocument } from "./control-document.js";
import { controlFinding, failedControl } from "./control-finding.js";
import { writtenControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";
import { isRecord, nonEmptyString } from "./value-shape.js";

const sourceMapPath = writtenControlPaths.sourceMap;
const requiredUnitKeys = [
  "topics",
  "lectures",
  "textbook",
  "tutorials",
] as const;
const optionalPathKeys = [
  "supplementary_materials",
  "past_papers",
  "practice_tests",
  "historical_reference",
] as const;
const allowedUnitKeys = [
  ...requiredUnitKeys,
  ...optionalPathKeys,
  "teaching_weeks",
];

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
  const problems = [
    ...undeclaredFields(value, ["units"], "Source Map"),
    ...units.flatMap(([key, unit]) => unitProblems(key, unit)),
  ];
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
  return [
    ...undeclaredFields(unit, allowedUnitKeys, unitName),
    ...requiredUnitKeys.flatMap((unitKey) => {
      const entries = unit[unitKey];
      if (!Array.isArray(entries)) {
        return [`${unitName} requires ${unitKey} as a sequence.`];
      }
      return entries.flatMap((entry, index) => {
        if (unitKey === "tutorials") {
          return tutorialProblems(
            entry,
            `${unitName} tutorials entry ${index + 1}`,
          );
        }
        if (!nonEmptyString(entry)) {
          return [`${unitName} has an empty ${unitKey} entry.`];
        }
        return unitKey !== "topics" && !isModuleRelative(entry)
          ? [
              `${unitName} lists ${unitKey} entry ${JSON.stringify(entry)}, which is not module-relative.`,
            ]
          : [];
      });
    }),
    ...optionalPathKeys.flatMap((pathKey) =>
      unit[pathKey] === undefined
        ? []
        : pathSequenceProblems(unit[pathKey], `${unitName} ${pathKey}`),
    ),
    ...teachingWeekProblems(unit.teaching_weeks, unitName),
  ];
}

function pathSequenceProblems(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) return [`${name} must be a sequence.`];
  return value.flatMap((entry) =>
    nonEmptyString(entry) && isModuleRelative(entry)
      ? []
      : [`${name} entries must be non-empty module-relative paths.`],
  );
}

function teachingWeekProblems(value: unknown, unitName: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((week) => !Number.isInteger(week) || Number(week) < 1) ||
    new Set(value).size !== value.length
  ) {
    return [
      `${unitName} teaching_weeks must be a non-empty sequence of unique positive integers.`,
    ];
  }
  return [];
}

function tutorialProblems(entry: unknown, name: string): string[] {
  if (nonEmptyString(entry)) {
    return isModuleRelative(entry)
      ? []
      : [`${name} ${JSON.stringify(entry)} is not module-relative.`];
  }
  if (!isRecord(entry))
    return [`${name} is neither a path nor a tutorial block.`];
  const problems = undeclaredFields(
    entry,
    ["block", "exercises", "sources"],
    name,
  );
  if (!nonEmptyString(entry.block))
    problems.push(`${name} requires a non-empty block.`);
  if (!nonEmptyString(entry.exercises)) {
    problems.push(`${name} requires a non-empty exercises locator.`);
  }
  if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
    problems.push(`${name} requires a non-empty sources sequence.`);
  } else {
    for (const [index, source] of entry.sources.entries()) {
      problems.push(
        ...tutorialSourceProblems(source, `${name} source ${index + 1}`),
      );
    }
  }
  return problems;
}

function tutorialSourceProblems(source: unknown, name: string): string[] {
  if (!isRecord(source)) return [`${name} is not a mapping.`];
  const problems = undeclaredFields(
    source,
    ["file", "locator", "role", "missing"],
    name,
  );
  if (!nonEmptyString(source.file) || !isModuleRelative(source.file)) {
    problems.push(`${name} file must be a non-empty module-relative path.`);
  }
  if (!nonEmptyString(source.locator))
    problems.push(`${name} requires a non-empty locator.`);
  if (!nonEmptyString(source.role))
    problems.push(`${name} requires a non-empty role.`);
  if (source.missing !== undefined && !nonEmptyStringList(source.missing)) {
    problems.push(
      `${name} missing must be a non-empty sequence of non-empty descriptions.`,
    );
  }
  return problems;
}

function undeclaredFields(
  value: Record<string, unknown>,
  allowed: string[],
  name: string,
): string[] {
  return Object.keys(value)
    .filter((field) => !allowed.includes(field))
    .map((field) => `${name} has unknown field ${JSON.stringify(field)}.`);
}

function nonEmptyStringList(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length > 0 && value.every(nonEmptyString)
  );
}

function isModuleRelative(path: string): boolean {
  return !path.startsWith("/") && !path.split("/").includes("..");
}
