import type { ResolvedResearchProject } from "../config/index.js";
import { readControlDocument } from "./control-document.js";
import { researchEnforcementForRule } from "./research-rule-enforcement.js";
import type {
  ResearchFinding,
  ResearchProjectProfile,
} from "./research-types.js";
import { isDirectoryName, isRecord, nonEmptyString } from "./value-shape.js";

const definitionPath = "00 Project Admin/10 Project Definition.yaml";
export const supportedResearchContractVersion = 1 as const;

export function validateResearchProjectDefinition(
  source: string | undefined,
  target: ResolvedResearchProject,
): ResearchFinding[] {
  const parsed = parseDefinition(source);
  if ("problems" in parsed) {
    return [
      finding(
        "RP-DEFINITION-001",
        "fail",
        parsed.problems.join(" "),
        "The Definition must use the closed research-project v1 shape.",
      ),
      finding(
        "RP-DEFINITION-002",
        "fail",
        "Profile-derived structure cannot be selected from an invalid Definition.",
        "The configured target and Definition must agree before profile structure is derived.",
      ),
    ];
  }
  const shapeProblems = validateShape(parsed.value);
  const shape = finding(
    "RP-DEFINITION-001",
    shapeProblems.length === 0 ? "pass" : "fail",
    shapeProblems.length === 0
      ? "Definition uses contract version 1 and the closed project, profile, and evidence fields."
      : shapeProblems.join(" "),
    "The Definition carries one supported machine-readable project declaration.",
  );
  if (shapeProblems.length > 0) {
    return [
      shape,
      finding(
        "RP-DEFINITION-002",
        "fail",
        "Configured identity cannot be compared with a malformed Definition.",
        "Profile-derived structure requires a valid Definition.",
      ),
    ];
  }
  const project = parsed.value.project as Record<string, unknown>;
  const expectedProfile: ResearchProjectProfile = target.profile ?? "generic";
  const contradictions = [
    ...(project.key === target.key
      ? []
      : [
          `project.key is ${render(project.key)}; configured key is ${target.key}.`,
        ]),
    ...(project.folder === target.folder
      ? []
      : [
          `project.folder is ${render(project.folder)}; configured folder is ${target.folder}.`,
        ]),
    ...(project.status === target.status
      ? []
      : [
          `project.status is ${render(project.status)}; configured status is ${target.status}.`,
        ]),
    ...(parsed.value.profile === expectedProfile
      ? []
      : [
          `profile is ${render(parsed.value.profile)}; configured profile is ${expectedProfile}.`,
        ]),
  ];
  return [
    shape,
    finding(
      "RP-DEFINITION-002",
      contradictions.length === 0 ? "pass" : "fail",
      contradictions.length === 0
        ? `Definition identifies ${target.key} at ${target.folder} with the ${expectedProfile} profile.`
        : contradictions.join(" "),
      "The exact configured target selects one deterministic profile structure.",
    ),
  ];
}

export function readResearchProjectProfile(
  source: string | undefined,
): ResearchProjectProfile | undefined {
  const parsed = parseDefinition(source);
  if ("problems" in parsed || validateShape(parsed.value).length > 0) {
    return undefined;
  }
  return parsed.value.profile as ResearchProjectProfile;
}

function parseDefinition(
  source: string | undefined,
): { value: Record<string, unknown> } | { problems: string[] } {
  if (source === undefined) {
    return { problems: [`No readable control exists at ${definitionPath}.`] };
  }
  const document = readControlDocument(source);
  if ("problems" in document) return document;
  return isRecord(document.value)
    ? { value: document.value }
    : { problems: ["The YAML root is not a mapping."] };
}

function validateShape(value: Record<string, unknown>): string[] {
  const problems: string[] = [];
  exactKeys(
    value,
    ["contract_version", "project", "profile", "evidence"],
    "Definition",
    problems,
  );
  if (value.contract_version !== supportedResearchContractVersion) {
    problems.push(
      `contract_version is ${render(value.contract_version)}; supported version is 1.`,
    );
  }
  if (!isRecord(value.project)) {
    problems.push("project must be a mapping.");
  } else {
    exactKeys(
      value.project,
      ["key", "folder", "title", "status"],
      "project",
      problems,
    );
    if (!nonEmptyString(value.project.key) || !isStableKey(value.project.key)) {
      problems.push("project.key must be a lowercase stable slug.");
    }
    if (!isDirectoryName(value.project.folder)) {
      problems.push("project.folder must be one exact directory name.");
    }
    if (!nonEmptyString(value.project.title)) {
      problems.push("project.title must be a non-empty string.");
    }
    if (
      value.project.status !== "active" &&
      value.project.status !== "inactive"
    ) {
      problems.push("project.status must be active or inactive.");
    }
  }
  if (value.profile !== "generic" && value.profile !== "ureca") {
    problems.push("profile must be generic or ureca.");
  }
  if (!isRecord(value.evidence)) {
    problems.push("evidence must be a mapping.");
  } else {
    exactKeys(
      value.evidence,
      ["identity", "confirmation"],
      "evidence",
      problems,
    );
    if (
      value.evidence.identity !== "owner-supplied" &&
      value.evidence.identity !== "official-source"
    ) {
      problems.push(
        "evidence.identity must be owner-supplied or official-source.",
      );
    }
    if (
      value.evidence.confirmation !== "confirmed" &&
      value.evidence.confirmation !== "unresolved"
    ) {
      problems.push("evidence.confirmation must be confirmed or unresolved.");
    }
  }
  return problems;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
  problems: string[],
): void {
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !(key in value));
  const extra = Object.keys(value).filter((key) => !expectedSet.has(key));
  if (missing.length > 0) {
    problems.push(`${field} lacks ${missing.join(", ")}.`);
  }
  if (extra.length > 0) {
    problems.push(`${field} has unsupported fields ${extra.join(", ")}.`);
  }
}

function finding(
  ruleId: "RP-DEFINITION-001" | "RP-DEFINITION-002",
  status: "pass" | "fail",
  evidence: string,
  explanation: string,
): ResearchFinding {
  return {
    ruleId,
    enforcement: researchEnforcementForRule(ruleId),
    status,
    severity: status === "pass" ? "information" : "error",
    path: definitionPath,
    evidence,
    explanation,
    applicability:
      "Definition validation applies to every configured research project.",
  };
}

function isStableKey(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function render(value: unknown): string {
  return value === undefined ? "<missing>" : JSON.stringify(value);
}
