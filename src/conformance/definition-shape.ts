import { isRecord, nonEmptyString } from "./control-finding.js";

export const contextualAssessments = [
  "quizzes",
  "tests",
  "assignments",
] as const;
export const contextualWorkspaces = ["projects", "labs"] as const;

export interface ValidatedDefinition {
  code: string;
  title: string;
  academicYear: string;
  semester: number;
}

export function readDefinitionIdentity(
  value: Record<string, unknown>,
): ValidatedDefinition | undefined {
  const module = value.module;
  const offering = value.offering;
  if (
    !isRecord(module) ||
    !isRecord(offering) ||
    !nonEmptyString(module.code) ||
    !nonEmptyString(module.title) ||
    !nonEmptyString(offering.academic_year) ||
    typeof offering.semester !== "number"
  ) {
    return undefined;
  }
  return {
    code: module.code,
    title: module.title,
    academicYear: offering.academic_year,
    semester: offering.semester,
  };
}

export function validateDefinitionShape(
  value: Record<string, unknown>,
  identity: ValidatedDefinition | undefined,
): string[] {
  return [
    ...validateIdentityAndOffering(value, identity),
    ...validateStructure(value.structure),
    ...validateSources(value.sources),
    ...validateEvidence(value.evidence),
    ...validateExceptions(value.exceptions),
  ];
}

function validateIdentityAndOffering(
  value: Record<string, unknown>,
  identity: ValidatedDefinition | undefined,
): string[] {
  if (identity === undefined) {
    return [
      "module.code, module.title, offering.academic_year, and numeric offering.semester are required.",
    ];
  }
  const problems: string[] = [];
  if (!/^[A-Z]{2,4}\d{4}[A-Z]?$/.test(identity.code)) {
    problems.push(
      `module.code ${identity.code} is not an uppercase module code.`,
    );
  }
  if (!/^\d{4}-\d{4}$/.test(identity.academicYear)) {
    problems.push(
      `offering.academic_year ${identity.academicYear} is not YYYY-YYYY.`,
    );
  }
  if (![1, 2].includes(identity.semester)) {
    problems.push(`offering.semester ${identity.semester} is not 1 or 2.`);
  }
  const offering = value.offering;
  if (
    !isRecord(offering) ||
    !["active", "past", "future"].includes(String(offering.status))
  ) {
    problems.push("offering.status must be active, past, or future.");
  }
  return problems;
}

function validateStructure(value: unknown): string[] {
  if (!isRecord(value)) return ["structure must be a mapping."];
  const problems: string[] = [];
  const tutorials = value.tutorials;
  if (
    !isRecord(tutorials) ||
    !["flat", "grouped"].includes(String(tutorials.layout))
  ) {
    problems.push("structure.tutorials.layout must be flat or grouped.");
  }
  const assessments = value.assessments;
  if (!isRecord(assessments)) {
    problems.push("structure.assessments must be a mapping.");
  } else {
    for (const category of contextualAssessments) {
      validateEnabledDeclaration(
        assessments[category],
        `structure.assessments.${category}`,
        problems,
      );
    }
  }
  for (const workspace of contextualWorkspaces) {
    validateEnabledDeclaration(
      value[workspace],
      `structure.${workspace}`,
      problems,
    );
  }
  if (
    !Array.isArray(value.resource_categories) ||
    !value.resource_categories.every(nonEmptyString)
  ) {
    problems.push("structure.resource_categories must be a string list.");
  }
  return problems;
}

function validateSources(value: unknown): string[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.ntulearn) ||
    value.ntulearn.length === 0
  ) {
    return ["sources.ntulearn must declare at least one importer root."];
  }
  const problems: string[] = [];
  for (const [index, root] of value.ntulearn.entries()) {
    if (
      !isRecord(root) ||
      !nonEmptyString(root.role) ||
      !isModuleRoot(root.destination) ||
      !Array.isArray(root.evidence) ||
      root.evidence.length === 0 ||
      !root.evidence.every(nonEmptyString)
    ) {
      problems.push(
        `sources.ntulearn[${index}] requires a role, one module-relative root destination, and a non-empty evidence reference list.`,
      );
    }
  }
  const destinations = value.ntulearn.flatMap((root) =>
    isRecord(root) && nonEmptyString(root.destination)
      ? [root.destination]
      : [],
  );
  if (!destinations.includes("NTULearn")) {
    problems.push("sources.ntulearn must declare the universal NTULearn root.");
  }
  if (new Set(destinations).size !== destinations.length) {
    problems.push("sources.ntulearn contains duplicate destination roots.");
  }
  return problems;
}

function validateEvidence(value: unknown): string[] {
  if (!isRecord(value)) return ["evidence must be a mapping."];
  const problems: string[] = [];
  for (const [name, item] of Object.entries(value)) {
    if (
      !isRecord(item) ||
      !nonEmptyString(item.source) ||
      !nonEmptyString(item.checked_at) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.checked_at)
    ) {
      problems.push(
        `evidence.${name} requires source and checked_at in YYYY-MM-DD form.`,
      );
    }
  }
  return problems;
}

function validateExceptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ["exceptions must be a list, including when empty."];
  }
  const problems: string[] = [];
  for (const [index, exception] of value.entries()) {
    if (
      !isRecord(exception) ||
      !nonEmptyString(exception.rule) ||
      !nonEmptyString(exception.reason) ||
      !Array.isArray(exception.evidence) ||
      exception.evidence.length === 0 ||
      !exception.evidence.every(nonEmptyString)
    ) {
      problems.push(
        `exceptions[${index}] requires rule, reason, and a non-empty evidence reference list.`,
      );
    }
  }
  return problems;
}

function validateEnabledDeclaration(
  value: unknown,
  field: string,
  problems: string[],
): void {
  if (
    !isRecord(value) ||
    ![true, false, "unknown"].includes(value.enabled as never)
  ) {
    problems.push(`${field}.enabled must be true, false, or unknown.`);
  }
}

function isModuleRoot(value: unknown): value is string {
  return (
    nonEmptyString(value) &&
    !value.startsWith("/") &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".."
  );
}
