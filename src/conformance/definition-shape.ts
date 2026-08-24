import { isAbsolute, win32 } from "node:path";

import { citesImporterInterior } from "../contract/importer-citations.js";
import { isDirectoryName, isRecord, nonEmptyString } from "./value-shape.js";
import { universalStructurePaths } from "../contract/universal-structure.js";

export const contextualAssessments = [
  "quizzes",
  "tests",
  "assignments",
] as const;
export const contextualWorkspaces = ["projects", "labs"] as const;
const universalRootPaths = new Set<string>(
  universalStructurePaths
    .filter(([path]) => !path.includes("/"))
    .map(([path]) => path),
);

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
    ...validateDeclaredFields(value),
    ...validatePortableValues(value),
    ...validateIdentityAndOffering(value, identity),
    ...validateStructure(value.structure),
    ...validateSources(value.sources),
    ...validateEvidence(value.evidence, declaredImporterRoots(value.sources)),
    ...validateExceptions(value.exceptions),
  ];
}

function validateDeclaredFields(value: Record<string, unknown>): string[] {
  const problems = undeclaredFields(value, "Definition", [
    "schema_version",
    "contract_version",
    "module",
    "offering",
    "structure",
    "sources",
    "evidence",
    "exceptions",
  ]);
  if (isRecord(value.module)) {
    problems.push(
      ...undeclaredFields(value.module, "module", ["code", "title"]),
    );
  }
  if (isRecord(value.offering)) {
    problems.push(
      ...undeclaredFields(value.offering, "offering", [
        "academic_year",
        "semester",
        "status",
      ]),
    );
  }
  if (isRecord(value.structure)) {
    problems.push(
      ...undeclaredFields(value.structure, "structure", [
        "tutorials",
        "assessments",
        "projects",
        "labs",
        "resource_categories",
      ]),
    );
    if (isRecord(value.structure.tutorials)) {
      problems.push(
        ...undeclaredFields(value.structure.tutorials, "structure.tutorials", [
          "layout",
          "groups",
          "evidence",
        ]),
      );
    }
    if (isRecord(value.structure.assessments)) {
      problems.push(
        ...undeclaredFields(
          value.structure.assessments,
          "structure.assessments",
          [...contextualAssessments],
        ),
      );
      for (const category of contextualAssessments) {
        const declaration = value.structure.assessments[category];
        if (isRecord(declaration)) {
          problems.push(
            ...undeclaredFields(
              declaration,
              `structure.assessments.${category}`,
              ["enabled", "evidence"],
            ),
          );
        }
      }
    }
    for (const workspace of contextualWorkspaces) {
      const declaration = value.structure[workspace];
      if (isRecord(declaration)) {
        problems.push(
          ...undeclaredFields(declaration, `structure.${workspace}`, [
            "enabled",
            "evidence",
          ]),
        );
      }
    }
    if (Array.isArray(value.structure.resource_categories)) {
      for (const [
        index,
        category,
      ] of value.structure.resource_categories.entries()) {
        if (isRecord(category)) {
          problems.push(
            ...undeclaredFields(
              category,
              `structure.resource_categories[${index}]`,
              ["name", "evidence"],
            ),
          );
        }
      }
    }
  }
  if (isRecord(value.sources)) {
    problems.push(...undeclaredFields(value.sources, "sources", ["ntulearn"]));
    if (Array.isArray(value.sources.ntulearn)) {
      for (const [index, root] of value.sources.ntulearn.entries()) {
        if (isRecord(root)) {
          problems.push(
            ...undeclaredFields(root, `sources.ntulearn[${index}]`, [
              "role",
              "destination",
              "evidence",
            ]),
          );
        }
      }
    }
  }
  if (isRecord(value.evidence)) {
    for (const [name, item] of Object.entries(value.evidence)) {
      if (isRecord(item)) {
        problems.push(
          ...undeclaredFields(item, `evidence.${name}`, [
            "source",
            "checked_at",
          ]),
        );
      }
    }
  }
  if (Array.isArray(value.exceptions)) {
    for (const [index, exception] of value.exceptions.entries()) {
      if (isRecord(exception)) {
        problems.push(
          ...undeclaredFields(exception, `exceptions[${index}]`, [
            "rule",
            "reason",
            "evidence",
          ]),
        );
      }
    }
  }
  return problems;
}

function undeclaredFields(
  value: Record<string, unknown>,
  location: string,
  allowed: readonly string[],
): string[] {
  const allowedFields = new Set(allowed);
  return Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .sort()
    .map((field) => `${location} has undeclared field ${field}.`);
}

function validatePortableValues(
  value: unknown,
  location = "Definition",
): string[] {
  if (typeof value === "string") {
    return isAbsolute(value) ||
      win32.isAbsolute(value) ||
      value.startsWith("~/")
      ? [
          `${location} contains absolute personal path ${JSON.stringify(value)}.`,
        ]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      validatePortableValues(item, `${location}[${index}]`),
    );
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([field, item]) =>
    validatePortableValues(item, `${location}.${field}`),
  );
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
  } else if (tutorials.layout === "grouped") {
    if (
      !Array.isArray(tutorials.groups) ||
      tutorials.groups.length === 0 ||
      !tutorials.groups.every(isDirectoryName) ||
      new Set(tutorials.groups).size !== tutorials.groups.length
    ) {
      problems.push(
        "grouped structure.tutorials requires a non-empty list of unique directory names in groups.",
      );
    }
    validateEvidenceList(tutorials, "structure.tutorials", problems);
  } else if ("groups" in tutorials) {
    problems.push("flat structure.tutorials must not declare groups.");
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
  if (!Array.isArray(value.resource_categories)) {
    problems.push("structure.resource_categories must be a list.");
  } else {
    const names: string[] = [];
    for (const [index, category] of value.resource_categories.entries()) {
      if (!isRecord(category) || !isDirectoryName(category.name)) {
        problems.push(
          `structure.resource_categories[${index}] requires one directory name.`,
        );
        continue;
      }
      if (category.name === "00 Unclassified") {
        problems.push(
          "structure.resource_categories must not redeclare 00 Unclassified.",
        );
      }
      names.push(category.name);
      validateEvidenceList(
        category,
        `structure.resource_categories[${index}]`,
        problems,
      );
    }
    if (new Set(names).size !== names.length) {
      problems.push("structure.resource_categories contains duplicate names.");
    }
  }
  return problems;
}

function validateEvidenceList(
  value: Record<string, unknown>,
  field: string,
  problems: string[],
): void {
  if (
    !Array.isArray(value.evidence) ||
    value.evidence.length === 0 ||
    !value.evidence.every(nonEmptyString)
  ) {
    problems.push(`${field} requires a non-empty evidence reference list.`);
  }
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
  const destinations = declaredDestinations(value);
  if (!destinations.includes("NTULearn")) {
    problems.push("sources.ntulearn must declare the universal NTULearn root.");
  }
  if (new Set(destinations).size !== destinations.length) {
    problems.push("sources.ntulearn contains duplicate destination roots.");
  }
  for (const destination of destinations) {
    if (destination !== "NTULearn" && universalRootPaths.has(destination)) {
      problems.push(
        `sources.ntulearn destination ${destination} conflicts with universal structure.`,
      );
    }
  }
  return problems;
}

const NTULEARN_INTEGRATION = "ntulearn";

function declaredDestinations(value: Record<string, unknown>): string[] {
  return Array.isArray(value.ntulearn)
    ? value.ntulearn.flatMap((root) =>
        isRecord(root) && nonEmptyString(root.destination)
          ? [root.destination]
          : [],
      )
    : [];
}

export function declaredImporterRoots(value: unknown): string[] {
  return [
    ...new Set([
      "NTULearn",
      ...(isRecord(value) ? declaredDestinations(value) : []),
    ]),
  ];
}

// A Definition's `sources` maps an **integration key** to the roots it writes into, and the two are
// different vocabularies: a Curation-register line records the key (`ntulearn`), while the folder a
// walk opens is the destination (`NTULearn`). Reading one where the other belongs matches nothing,
// so callers that need both take them paired rather than deriving one from the other.
export interface DeclaredImporterSource {
  integration: string;
  destinations: string[];
}

export function declaredImporterSources(
  value: unknown,
): DeclaredImporterSource[] {
  const destinations = isRecord(value) ? declaredDestinations(value) : [];
  return [
    {
      integration: NTULEARN_INTEGRATION,
      destinations: [...new Set(["NTULearn", ...destinations])],
    },
  ];
}

// The file name is the repair, except where the importer's own name for a thing identifies
// nothing — `ultraDocumentBody.md` is its name for every folder's page — and there the document has
// to be named in words instead.
function citationRepair(source: string): string {
  const name = source.split("/").at(-1) ?? source;
  return name.startsWith("ultraDocumentBody")
    ? "the document by name"
    : `the file name ${name}`;
}

function validateEvidence(value: unknown, roots: readonly string[]): string[] {
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
      continue;
    }
    if (citesImporterInterior(item.source, roots)) {
      problems.push(
        `evidence.${name}.source walks into the importer's interior; cite ${citationRepair(item.source)}.`,
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

const isModuleRoot = isDirectoryName;
