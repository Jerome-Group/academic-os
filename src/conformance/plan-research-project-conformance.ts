import { parseDocument } from "yaml";

import type { ResolvedResearchProject } from "../config/index.js";
import type { ResearchProjectContract } from "./research-project-contract.js";
import { applicableResearchRuleIds } from "./research-project-contract.js";
import {
  type ResearchProjectControls,
  researchProjectControlPaths,
} from "./research-project-control-paths.js";
import {
  type ResearchContractRuleId,
  researchEnforcementForRule,
} from "./research-rule-enforcement.js";
import type {
  ResearchAuditResult,
  ResearchFinding,
  ResearchProjectInventory,
  ResearchProjectProfile,
} from "./research-types.js";
import {
  validateResearchProjectClaims,
  validateResearchProjectDeliverableRegister,
  validateResearchProjectMap,
  validateResearchProjectProfile,
  validateResearchProjectQuestions,
  validateResearchProjectSourcePlacement,
  validateResearchProjectSourceRegister,
  validateResearchProjectTaskProvenance,
  validateResearchProjectTaskRegister,
} from "./validate-research-project-controls.js";
import { validateResearchProjectDefinition } from "./validate-research-project-definition.js";
import { isRecord } from "./value-shape.js";

export interface ProposedResearchConformanceOperation {
  kind: "create-directory" | "create-file";
  path: string;
  ruleId: "RP-UNIVERSAL-001" | "RP-PROFILE-STRUCTURE-001";
}

export interface ResearchProjectConformancePlan extends ResearchAuditResult {
  contractVersion: number | "unavailable";
  proposedOperations: ProposedResearchConformanceOperation[];
}

export function planResearchProjectConformance(input: {
  contract: ResearchProjectContract;
  target: ResolvedResearchProject;
  inventory: ResearchProjectInventory;
  controls: ResearchProjectControls;
}): ResearchProjectConformancePlan {
  assertUsableContract(input.contract);
  const profile: ResearchProjectProfile = input.target.profile ?? "generic";
  const expected = [
    ...input.contract.universalStructure,
    ...input.contract.profiles[profile],
  ];
  const findings: ResearchFinding[] = [
    identityFinding(input),
    ...requiredPathFindings(
      input.inventory,
      input.contract.universalStructure,
      "RP-UNIVERSAL-001",
      "Universal structure applies to every Research project.",
    ),
    ...requiredPathFindings(
      input.inventory,
      input.contract.profiles[profile],
      "RP-PROFILE-STRUCTURE-001",
      `The configured ${profile} profile derives this structure.`,
    ),
    rootPlacementFinding(input.inventory, expected),
    mountArtifactFinding(input.inventory),
    ...validateResearchProjectDefinition(
      input.controls.definition,
      input.target,
    ),
    ...validateResearchProjectProfile({
      source: input.controls.profile,
      definition: input.controls.definition,
      target: input.target,
    }),
    profileEvidenceFinding(input.controls.profile),
    agentsRouterFinding(input.controls.agents),
    claudeFinding(input.controls.claude),
    pinnedDocumentsFinding(input),
    contextFinding(input.controls.context, input.target.folder),
    closedHomeFinding(
      input.inventory,
      "00 Project Admin",
      input.contract.universalStructure,
      "RP-ADMIN-001",
      "Project Admin contains exactly the seven universal controls.",
    ),
    closedHomeFinding(
      input.inventory,
      "docs",
      input.contract.universalStructure,
      "RP-DOCS-001",
      "docs contains the four pinned procedures and its ADR home.",
    ),
    validateResearchProjectSourceRegister(input.controls.sourceRegister),
    validateResearchProjectSourcePlacement({
      source: input.controls.sourceRegister,
      inventory: input.inventory,
      profile,
    }),
    validateResearchProjectTaskRegister(input.controls.taskRegister),
    validateResearchProjectTaskProvenance({
      taskRegister: input.controls.taskRegister,
      sourceRegister: input.controls.sourceRegister,
      claims: input.controls.claims,
      deliverableRegister: input.controls.deliverableRegister,
      inventory: input.inventory,
    }),
    validateResearchProjectMap({
      source: input.controls.researchMap,
      sourceRegister: input.controls.sourceRegister,
      inventory: input.inventory,
    }),
    validateResearchProjectClaims(input.controls.claims),
    validateResearchProjectQuestions(input.controls.questions),
    validateResearchProjectDeliverableRegister(
      input.controls.deliverableRegister,
      profile,
    ),
    fixedPathCaseFinding(input.inventory, expected),
    latexFinding(input.inventory),
    monitoringFinding(input.target),
  ];
  addScopedFindings(findings, input);
  const applicable = applicableResearchRuleIds(input.contract);
  const selected = findings.filter(({ ruleId }) => applicable.has(ruleId));
  for (const ruleId of applicable) {
    if (!selected.some((finding) => finding.ruleId === ruleId)) {
      selected.push(outsideStructuralAudit(ruleId));
    }
  }
  selected.sort((left, right) =>
    left.ruleId === right.ruleId
      ? left.path.localeCompare(right.path)
      : left.ruleId.localeCompare(right.ruleId),
  );
  return {
    outcome: outcomeFor(selected),
    findings: selected,
    contractVersion: readContractVersion(input.controls.definition),
    proposedOperations: proposedOperations(
      input.inventory,
      input.contract,
      profile,
    ),
  };
}

function identityFinding(input: {
  target: ResolvedResearchProject;
  inventory: ResearchProjectInventory;
}): ResearchFinding {
  const matches = input.inventory.projectKey === input.target.key;
  return finding(
    "RP-ROOT-001",
    matches ? "pass" : "fail",
    ".",
    matches
      ? `Inventory and configured target use exact key ${input.target.key} and folder ${input.target.folder}.`
      : `Inventory key is ${input.inventory.projectKey}; configured key is ${input.target.key}.`,
    "Inventory must belong to the exact configured Research project.",
  );
}

function requiredPathFindings(
  inventory: ResearchProjectInventory,
  required: ReadonlyArray<readonly [string, "directory" | "file"]>,
  ruleId: "RP-UNIVERSAL-001" | "RP-PROFILE-STRUCTURE-001",
  applicability: string,
): ResearchFinding[] {
  if (required.length === 0) {
    return [
      finding(
        ruleId,
        "pass",
        ".",
        "This profile derives no additional path.",
        applicability,
      ),
    ];
  }
  const entries = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  return required.map(([path, kind]) => {
    const entry = entries.get(path);
    const matches = entry?.kind === kind;
    return finding(
      ruleId,
      matches ? "pass" : "fail",
      path,
      entry === undefined
        ? `Inventory has no entry at ${path}.`
        : matches
          ? `Inventory contains the required ${kind} at ${path}.`
          : `Inventory identifies ${path} as ${entry.kind}; required kind is ${kind}.`,
      applicability,
    );
  });
}

function rootPlacementFinding(
  inventory: ResearchProjectInventory,
  expected: ReadonlyArray<readonly [string, "directory" | "file"]>,
): ResearchFinding {
  const rootPaths = new Set(
    expected.filter(([path]) => !path.includes("/")).map(([path]) => path),
  );
  const unexpected = inventory.entries
    .filter(({ path }) => !path.includes("/") && !rootPaths.has(path))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (unexpected.length === 0) {
    return finding(
      "RP-ROOT-002",
      "pass",
      ".",
      "Inventory contains no unclassified Research-project root entry.",
      "Root placement applies to every Research project.",
    );
  }
  const unknownDirectory = unexpected.find(({ kind }) => kind === "directory");
  return finding(
    "RP-ROOT-002",
    unknownDirectory === undefined ? "fail" : "requires-decision",
    unknownDirectory?.path ?? unexpected[0]?.path ?? ".",
    `Inventory contains unclassified root entries: ${unexpected.map(({ path, kind }) => `${kind} ${path}`).join(", ")}.`,
    "Loose content is an error; an unknown root directory requires classification.",
  );
}

function mountArtifactFinding(
  inventory: ResearchProjectInventory,
): ResearchFinding {
  const visible = inventory.entries.filter(({ path, kind, size }) => {
    if (path.includes("/") || kind !== "file") return false;
    return path.startsWith(".") || (path === "Icon\r" && size === 0);
  });
  return finding(
    "RP-ROOT-003",
    visible.length === 0 ? "pass" : "fail",
    visible[0]?.path ?? ".",
    visible.length === 0
      ? "No mount artifact appears as project content; adapter exclusions remain preserved."
      : `Mount artifacts were not excluded from inventory: ${visible.map(({ path }) => path).join(", ")}.`,
    "Mounted inventory omits only dot-named files and a zero-byte Finder icon.",
  );
}

function profileEvidenceFinding(source: string | undefined): ResearchFinding {
  const hasEvidenceLanguage =
    source !== undefined &&
    /Evidence/u.test(source) &&
    /Known Gaps/u.test(source);
  return finding(
    "RP-PROFILE-002",
    hasEvidenceLanguage ? "manual-review" : "requires-decision",
    researchProjectControlPaths.profile,
    hasEvidenceLanguage
      ? "Profile exposes evidence and Known Gaps; factual accuracy remains a human review."
      : "Profile does not expose both evidence and Known Gaps for human review.",
    "Structural audit exposes, but does not settle, Profile fact authority.",
  );
}

function agentsRouterFinding(source: string | undefined): ResearchFinding {
  const expected = [
    "# What this folder is",
    "## Start here",
    "## Routes",
    "## Domain language",
    "## Safety",
    "## Updating these instructions",
  ];
  const headings = source?.match(/^#{1,2} .+$/gmu) ?? [];
  const routes = [
    "Sources",
    "Meetings",
    "Research",
    "Learning",
    "Deliverables",
    "Tasks",
    "Maintenance",
  ];
  const matches =
    JSON.stringify(headings) === JSON.stringify(expected) &&
    routes.every((route) => source?.includes(`**${route}**`));
  return finding(
    "RP-AGENTS-001",
    matches ? "pass" : "fail",
    researchProjectControlPaths.agents,
    matches
      ? "AGENTS has the six router sections and all seven routes."
      : "AGENTS does not match the required router surface.",
    "The local router is required in every Research project.",
  );
}

function claudeFinding(source: string | undefined): ResearchFinding {
  const expected =
    "# Claude Code\n\nRead `AGENTS.md` completely before working in this research-project folder.\n";
  return finding(
    "RP-AGENTS-002",
    source === expected ? "pass" : "fail",
    researchProjectControlPaths.claude,
    source === expected
      ? "CLAUDE.md contains only the canonical AGENTS pointer."
      : "CLAUDE.md differs from the canonical AGENTS pointer.",
    "CLAUDE.md is a pointer, never an independent instruction copy.",
  );
}

const pinnedControls = [
  "agents",
  "structureAndNaming",
  "sourcesAndProvenance",
  "researchProcedure",
  "deliverablesProcedure",
] as const satisfies ReadonlyArray<keyof ResearchProjectControls>;

function pinnedDocumentsFinding(input: {
  contract: ResearchProjectContract;
  target: ResolvedResearchProject;
  controls: ResearchProjectControls;
}): ResearchFinding {
  const different = pinnedControls.filter((name) => {
    const path = researchProjectControlPaths[name];
    const expected = input.contract.seedFiles[path]?.replaceAll(
      "{{PROJECT_NAME}}",
      input.target.folder,
    );
    return expected === undefined || input.controls[name] !== expected;
  });
  return finding(
    "RP-AGENTS-004",
    different.length === 0 ? "pass" : "fail",
    different.length === 0
      ? researchProjectControlPaths.agents
      : researchProjectControlPaths[different[0] ?? "agents"],
    different.length === 0
      ? "AGENTS and all four procedures are byte-identical to interpolated seed sources."
      : `Pinned controls differ from seed sources: ${different.join(", ")}.`,
    "Pinned Research-project documents carry the contract's own text.",
  );
}

function contextFinding(
  source: string | undefined,
  folder: string,
): ResearchFinding {
  const expected = `# ${folder} — context`;
  const matches =
    source?.startsWith(`${expected}\n`) === true &&
    source.includes("## Language");
  return finding(
    "RP-CONTEXT-001",
    matches ? "pass" : "fail",
    researchProjectControlPaths.context,
    matches
      ? "CONTEXT has the exact project heading and Language home."
      : `CONTEXT must start ${expected} and contain ## Language.`,
    "Every Research project has a project-organisational glossary.",
  );
}

function closedHomeFinding(
  inventory: ResearchProjectInventory,
  home: string,
  structure: ReadonlyArray<readonly [string, "directory" | "file"]>,
  ruleId: "RP-ADMIN-001" | "RP-DOCS-001",
  explanation: string,
): ResearchFinding {
  const prefix = `${home}/`;
  const expected = new Set(
    structure
      .map(([path]) => path)
      .filter(
        (path) =>
          path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
      ),
  );
  const actual = inventory.entries
    .map(({ path }) => path)
    .filter(
      (path) =>
        path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
    );
  const unexpected = actual.filter((path) => !expected.has(path));
  return finding(
    ruleId,
    unexpected.length === 0 ? "pass" : "fail",
    unexpected[0] ?? home,
    unexpected.length === 0
      ? `${home} has no unclassified direct child.`
      : `${home} has unclassified direct children: ${unexpected.join(", ")}.`,
    explanation,
  );
}

function fixedPathCaseFinding(
  inventory: ResearchProjectInventory,
  expected: ReadonlyArray<readonly [string, "directory" | "file"]>,
): ResearchFinding {
  const paths = inventory.entries.map(({ path }) => path);
  const variants = expected.flatMap(([path]) =>
    paths.some(
      (candidate) =>
        candidate !== path && candidate.toLowerCase() === path.toLowerCase(),
    )
      ? [path]
      : [],
  );
  return finding(
    "RP-NAMING-001",
    variants.length === 0 ? "pass" : "fail",
    variants[0] ?? ".",
    variants.length === 0
      ? "No fixed path has a case variant."
      : `Fixed paths have case variants: ${variants.join(", ")}.`,
    "Fixed Research-project paths use exact spelling and case.",
  );
}

function latexFinding(inventory: ResearchProjectInventory): ResearchFinding {
  const rootBuild = inventory.entries.find(({ path }) => path === "build");
  return finding(
    "RP-LATEX-001",
    rootBuild === undefined ? "pass" : "fail",
    rootBuild?.path ?? ".scratch",
    rootBuild === undefined
      ? "No project-root build directory is present; .scratch remains the disposable root."
      : "A project-root build directory is prohibited.",
    "LaTeX builds live beside a real workspace and are never universal seed structure.",
  );
}

function monitoringFinding(target: ResolvedResearchProject): ResearchFinding {
  return finding(
    "RP-AUDIT-003",
    target.status === "active" ? "pass" : "not-applicable",
    ".",
    target.status === "active"
      ? `Configured Research project ${target.key} is active and eligible for monitoring.`
      : `Configured Research project ${target.key} is inactive and therefore read-only.`,
    "Monitoring selection follows configured Research-project status.",
  );
}

function addScopedFindings(
  findings: ResearchFinding[],
  input: {
    contract: ResearchProjectContract;
    target: ResolvedResearchProject;
    controls: ResearchProjectControls;
  },
): void {
  findings.push(
    finding(
      "RP-AGENTS-003",
      "not-applicable",
      "AGENTS.md",
      "Structural audit observes pinned instructions; instruction-edit approval is a separate operation.",
      "This rule applies when a document agents read is changed.",
    ),
    finding(
      "RP-INTEGRITY-001",
      input.controls.contributionAndAiUse?.includes(
        "The Owner authors the mathematics",
      ) === true
        ? "manual-review"
        : "requires-decision",
      researchProjectControlPaths.contributionAndAiUse,
      "The standing authorship boundary is present; adopted-assistance rows require human review.",
      "Structural audit checks the control surface, not human understanding.",
    ),
    finding(
      "RP-SOURCES-003",
      "manual-review",
      "70 Research",
      "Claim-to-source locators and authority conflicts require content review.",
      "Structural audit does not judge mathematical source support.",
    ),
    finding(
      "RP-RESEARCH-002",
      "manual-review",
      "70 Research",
      "Durable research-pass quality requires human review.",
      "Structural audit does not judge mathematical completion.",
    ),
    finding(
      "RP-RESEARCH-003",
      "manual-review",
      ".scratch",
      "Agent-authored candidate mathematics and Owner adoption require human review.",
      "Structural audit does not infer authorship from file placement.",
    ),
    finding(
      "RP-RESEARCH-004",
      "manual-review",
      "20 Supervisor Meetings",
      "Meeting-note evidence and Owner confirmation require human review.",
      "Structural audit does not judge meeting prose.",
    ),
    finding(
      "RP-DELIVERABLES-002",
      "manual-review",
      "30 Deliverables",
      "Deliverable authorship, feedback attribution and submission evidence require human review.",
      "Structural audit does not judge assessed prose.",
    ),
    finding(
      "RP-DELIVERABLES-003",
      "pass",
      researchProjectControlPaths.deliverableRegister,
      "Definition holds no task progress or exact deadline; dedicated registers remain separate.",
      "Deliverable state, Tasks and Calendar have separate authorities.",
    ),
    finding(
      "RP-NAMING-002",
      "manual-review",
      ".",
      "Draft and programme-mandated content names require content review.",
      "Structural audit checks fixed names, not every open-interior content name.",
    ),
    finding(
      "RP-NAMING-003",
      "pass",
      ".scratch",
      "The fixed-path audit does not govern exempt scratch, build or template interiors.",
      "Naming exemptions remain outside fixed-path enforcement.",
    ),
    finding(
      "RP-CALENDAR-001",
      "not-applicable",
      researchProjectControlPaths.definition,
      "The closed Definition carries no date or Calendar field; live milestone authority is external.",
      "Calendar confirmation is verified at proposal and promotion boundaries.",
    ),
    finding(
      "RP-AUDIT-001",
      "pass",
      ".",
      "Planner emits typed rule findings with evidence and applicability.",
      "Every structural audit uses the contract finding vocabulary.",
    ),
    finding(
      "RP-AUDIT-002",
      "pass",
      ".",
      "Planner checks identity, structure, closed homes, controls and pinned files without judging mathematics.",
      "Structural audit is bounded to contract-observable evidence.",
    ),
    finding(
      "RP-SEED-001",
      "not-applicable",
      ".",
      "Research and Owner confirmation precede the seed planner; structural audit cannot prove them.",
      "This rule applies while preparing a seed request.",
    ),
    finding(
      "RP-SEED-002",
      "not-applicable",
      ".",
      "Additive execution, conflict handling and journalling are enforced by the mounted executor.",
      "This rule applies while previewing or applying a seed plan.",
    ),
    finding(
      "RP-TRANSITION-001",
      "not-applicable",
      researchProjectControlPaths.definition,
      `Definition targets current contract version ${input.contract.version}; no transition is being planned.`,
      "This rule applies to a pre-contract or earlier-version project.",
    ),
  );
}

function proposedOperations(
  inventory: ResearchProjectInventory,
  contract: ResearchProjectContract,
  profile: ResearchProjectProfile,
): ProposedResearchConformanceOperation[] {
  const present = new Set(inventory.entries.map(({ path }) => path));
  return [
    ...contract.universalStructure.map(
      ([path, kind]) => [path, kind, "RP-UNIVERSAL-001"] as const,
    ),
    ...contract.profiles[profile].map(
      ([path, kind]) => [path, kind, "RP-PROFILE-STRUCTURE-001"] as const,
    ),
  ]
    .filter(([path]) => !present.has(path))
    .map(
      ([path, kind, ruleId]): ProposedResearchConformanceOperation => ({
        kind: kind === "directory" ? "create-directory" : "create-file",
        path,
        ruleId,
      }),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

function assertUsableContract(contract: ResearchProjectContract): void {
  const rules = applicableResearchRuleIds(contract);
  if (
    contract.version !== 1 ||
    contract.ruleIds.length === 0 ||
    rules.size !== contract.ruleIds.length ||
    contract.universalStructure.length === 0 ||
    contract.profiles.generic === undefined ||
    contract.profiles.ureca === undefined
  ) {
    throw new TypeError(
      "Research conformance planning requires a complete contract.",
    );
  }
}

function outsideStructuralAudit(
  ruleId: ResearchContractRuleId,
): ResearchFinding {
  return finding(
    ruleId,
    "not-applicable",
    ".",
    "This rule has no structural-audit assertion for the selected evidence.",
    "The rule applies at its own operation or human-review boundary.",
  );
}

function finding(
  ruleId: ResearchContractRuleId,
  status: ResearchFinding["status"],
  path: string,
  evidence: string,
  explanation: string,
): ResearchFinding {
  return {
    ruleId,
    enforcement: researchEnforcementForRule(ruleId),
    status,
    severity:
      status === "fail"
        ? "error"
        : status === "requires-decision"
          ? "decision"
          : status === "warning" || status === "manual-review"
            ? "warning"
            : "information",
    path,
    evidence,
    explanation,
    applicability: explanation,
  };
}

function outcomeFor(
  findings: readonly ResearchFinding[],
): ResearchAuditResult["outcome"] {
  if (findings.some(({ status }) => status === "requires-decision")) {
    return "requires-decision";
  }
  return findings.some(({ status }) => status === "fail")
    ? "deviation"
    : "conformant";
}

function readYamlRecord(
  source: string | undefined,
): Record<string, unknown> | undefined {
  if (source === undefined) return undefined;
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) return undefined;
  const value: unknown = document.toJS();
  return isRecord(value) ? value : undefined;
}

function readContractVersion(
  source: string | undefined,
): number | "unavailable" {
  const value = readYamlRecord(source);
  return typeof value?.contract_version === "number" &&
    Number.isInteger(value.contract_version) &&
    value.contract_version > 0
    ? value.contract_version
    : "unavailable";
}
