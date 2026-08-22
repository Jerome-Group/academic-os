import { parseDocument } from "yaml";

import { controlFinding, failedControl } from "./control-finding.js";
import { writtenControlPaths } from "./control-paths.js";
import {
  contextualAssessments,
  contextualWorkspaces,
  declaredImporterRoots,
  readDefinitionIdentity,
  type ValidatedDefinition,
  validateDefinitionShape,
} from "./definition-shape.js";
import { isRecord, nonEmptyString } from "./value-shape.js";
import type { Finding } from "./types.js";

const definitionPath = writtenControlPaths.definition;
export const supportedContractVersion = 4 as const;
export type { ValidatedDefinition } from "./definition-shape.js";

export interface DefinitionValidation {
  findings: Finding[];
  definition?: ValidatedDefinition;
  importerRoots: string[];
}

export function readDefinitionContractVersion(
  source: string | undefined,
): number | "unavailable" {
  if (source === undefined) return "unavailable";
  const parsed = parseDefinitionSource(source);
  if (parsed.errors.length > 0) return "unavailable";
  const value = parsed.value;
  if (!isRecord(value) || typeof value.contract_version !== "number") {
    return "unavailable";
  }
  return Number.isInteger(value.contract_version) && value.contract_version > 0
    ? value.contract_version
    : "unavailable";
}

export function validateDefinition(
  source: string | undefined,
  expectedCode: string,
  expectedSemester: string,
  expectedContractVersion: number = supportedContractVersion,
): DefinitionValidation {
  if (source === undefined) {
    return {
      findings: [
        failedControl("MF-DEFINITION-001", definitionPath, [
          `No readable control exists at ${definitionPath}.`,
        ]),
      ],
      importerRoots: declaredImporterRoots(undefined),
    };
  }

  const parsed = parseDefinitionSource(source);
  if (parsed.errors.length > 0) {
    return {
      findings: [
        failedControl("MF-DEFINITION-001", definitionPath, parsed.errors),
      ],
      importerRoots: declaredImporterRoots(undefined),
    };
  }

  const value = parsed.value;
  if (!isRecord(value)) {
    return {
      findings: [
        failedControl("MF-DEFINITION-001", definitionPath, [
          "The YAML root is not a mapping.",
        ]),
      ],
      importerRoots: declaredImporterRoots(undefined),
    };
  }

  const findings: Finding[] = [];
  const importerRoots = declaredImporterRoots(value.sources);
  const versionProblems = validateVersions(value, expectedContractVersion);
  findings.push(
    versionProblems.length === 0
      ? controlFinding(
          "MF-DEFINITION-001",
          definitionPath,
          "pass",
          `schema_version is 2 and contract_version is the requested version ${expectedContractVersion}.`,
          "The Definition uses supported schema and contract versions.",
        )
      : failedControl("MF-DEFINITION-001", definitionPath, versionProblems),
  );
  if (versionProblems.length > 0) {
    return { findings, importerRoots };
  }

  const identity = readDefinitionIdentity(value);
  const shapeProblems = validateDefinitionShape(value, identity);
  findings.push(
    shapeProblems.length === 0
      ? controlFinding(
          "MF-DEFINITION-001",
          definitionPath,
          "pass",
          "Identity, offering, structure, importer roots, evidence, and exceptions match schema version 2.",
          "The Definition contains the required machine-readable fields.",
        )
      : failedControl("MF-DEFINITION-001", definitionPath, shapeProblems),
  );

  if (identity !== undefined) {
    const expectedTerm = semesterNumber(expectedSemester);
    const contradictions = [
      ...(identity.code === expectedCode
        ? []
        : [
            `module.code is ${identity.code}; selected module is ${expectedCode}.`,
          ]),
      ...(expectedTerm === undefined || identity.semester === expectedTerm
        ? []
        : [
            `offering.semester is ${identity.semester}; selected semester ${expectedSemester} denotes semester ${expectedTerm}.`,
          ]),
    ];
    findings.push(
      contradictions.length === 0
        ? controlFinding(
            "MF-DEFINITION-001",
            definitionPath,
            "pass",
            `Definition identifies ${identity.code}, ${identity.academicYear} semester ${identity.semester}.`,
            "Definition identity and offering agree with the selected module.",
          )
        : controlFinding(
            "MF-DEFINITION-001",
            definitionPath,
            "requires-decision",
            contradictions.join(" "),
            "Selected-folder and Definition evidence contradict each other.",
          ),
    );
  }

  const evidenceProblems = validateContextEvidence(value);
  findings.push(
    evidenceProblems.length === 0
      ? controlFinding(
          "MF-DEFINITION-002",
          definitionPath,
          "pass",
          "Every enabled contextual category and importer root cites declared evidence; no structure is ambiguous.",
          "Context-derived structure has sufficient evidence.",
        )
      : controlFinding(
          "MF-DEFINITION-002",
          definitionPath,
          "requires-decision",
          evidenceProblems.join(" "),
          "Context-derived structure cannot be selected from this evidence.",
        ),
  );

  return {
    findings,
    importerRoots,
    ...(identity === undefined ? {} : { definition: identity }),
  };
}

function validateVersions(
  value: Record<string, unknown>,
  expectedContractVersion: number,
): string[] {
  const problems: string[] = [];
  if (value.schema_version !== 2) {
    problems.push(
      `Unsupported schema_version ${renderValue(value.schema_version)}; supported version is 2.`,
    );
  }
  if (value.contract_version !== expectedContractVersion) {
    problems.push(
      typeof value.contract_version === "number" &&
        value.contract_version < expectedContractVersion
        ? `contract_version ${value.contract_version} requires upgrade to requested version ${expectedContractVersion}.`
        : `Unsupported contract_version ${renderValue(value.contract_version)}; requested version is ${expectedContractVersion}.`,
    );
  }
  return problems;
}

function parseDefinitionSource(source: string): {
  value: unknown;
  errors: string[];
} {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  return {
    value: document.errors.length === 0 ? document.toJS() : undefined,
    errors: document.errors.map(
      ({ message }) => `YAML parser reported: ${oneLine(message)}`,
    ),
  };
}

function validateContextEvidence(value: Record<string, unknown>): string[] {
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const problems: string[] = [];
  const structure = isRecord(value.structure) ? value.structure : {};
  const tutorials = isRecord(structure.tutorials)
    ? structure.tutorials
    : undefined;
  if (tutorials?.layout === "grouped") {
    validateReferenceList(tutorials, "structure.tutorials", evidence, problems);
  }
  const assessments = isRecord(structure.assessments)
    ? structure.assessments
    : {};
  for (const category of contextualAssessments) {
    validateEvidenceReferences(
      assessments[category],
      `structure.assessments.${category}`,
      evidence,
      problems,
    );
  }
  for (const workspace of contextualWorkspaces) {
    validateEvidenceReferences(
      structure[workspace],
      `structure.${workspace}`,
      evidence,
      problems,
    );
  }
  if (Array.isArray(structure.resource_categories)) {
    for (const [index, category] of structure.resource_categories.entries()) {
      validateReferenceList(
        category,
        `structure.resource_categories[${index}]`,
        evidence,
        problems,
      );
    }
  }
  const sources = isRecord(value.sources) ? value.sources : {};
  if (Array.isArray(sources.ntulearn)) {
    for (const [index, root] of sources.ntulearn.entries()) {
      validateEvidenceReferences(
        root,
        `sources.ntulearn[${index}]`,
        evidence,
        problems,
        true,
      );
    }
  }
  if (Array.isArray(value.exceptions)) {
    for (const [index, exception] of value.exceptions.entries()) {
      validateReferenceList(
        exception,
        `exceptions[${index}]`,
        evidence,
        problems,
      );
    }
  }
  return problems;
}

function validateEvidenceReferences(
  declaration: unknown,
  field: string,
  evidence: Record<string, unknown>,
  problems: string[],
  alwaysRequired = false,
): void {
  if (!isRecord(declaration)) return;
  if (declaration.enabled === "unknown") {
    problems.push(`${field}.enabled is unknown.`);
    return;
  }
  if (alwaysRequired || declaration.enabled === true) {
    validateReferenceList(declaration, field, evidence, problems);
  }
}

function validateReferenceList(
  declaration: unknown,
  field: string,
  evidence: Record<string, unknown>,
  problems: string[],
): void {
  if (
    !isRecord(declaration) ||
    !Array.isArray(declaration.evidence) ||
    declaration.evidence.length === 0
  ) {
    problems.push(`${field} has no evidence references.`);
    return;
  }
  for (const reference of declaration.evidence) {
    if (!nonEmptyString(reference) || !isRecord(evidence[reference])) {
      problems.push(
        `${field} cites undeclared evidence ${renderValue(reference)}.`,
      );
    }
  }
}

function semesterNumber(semester: string): number | undefined {
  const match = /S([12])$/.exec(semester);
  return match === null ? undefined : Number(match[1]);
}

function renderValue(value: unknown): string {
  return value === undefined ? "<missing>" : JSON.stringify(value);
}

function oneLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
