import type { AuditResult, Finding, Inventory } from "./types.js";
import { deriveContextualStructure } from "./contextual-structure.js";
import { outcomeFor } from "./audit-universal-structure.js";

export function auditContextualStructure(
  inventory: Inventory,
  definitionSource: string | undefined,
): AuditResult {
  const expected = deriveContextualStructure(definitionSource);
  const entriesByPath = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  const findings = expected.paths.map((path): Finding => {
    const entry = entriesByPath.get(path);
    const ruleId = ruleFor(path);
    if (entry?.kind === "directory") {
      return {
        ruleId,
        status: "pass",
        severity: "information",
        path,
        evidence: `Inventory contains a directory at ${path}.`,
        explanation: "The approved context-derived directory is present.",
        applicability: "The Module Definition declares this structure.",
      };
    }
    return {
      ruleId,
      status: "fail",
      severity: "error",
      path,
      evidence:
        entry === undefined
          ? `Inventory has no entry at ${path}.`
          : `Inventory identifies ${path} as a ${entry.kind}.`,
      explanation: "The approved context-derived directory is required.",
      applicability: "The Module Definition declares this structure.",
    };
  });
  findings.push(...unexpectedControlledStructure(inventory, expected));
  return { outcome: outcomeFor(findings), findings };
}

function unexpectedControlledStructure(
  inventory: Inventory,
  expected: ReturnType<typeof deriveContextualStructure>,
): Finding[] {
  const expectedPaths = new Set(expected.paths);
  const fixedOptionalPaths = [
    "30 Assessments/10 Quizzes",
    "30 Assessments/20 Tests",
    "30 Assessments/50 Assignments",
    "40 Projects and Labs/10 Projects",
    "40 Projects and Labs/20 Labs",
  ];
  const findings: Finding[] = [];
  for (const path of fixedOptionalPaths) {
    const entry = inventory.entries.find(
      (candidate) => candidate.path === path,
    );
    if (entry !== undefined && !expectedPaths.has(path)) {
      findings.push(unapprovedFinding(path, ruleFor(path), "fail"));
    }
  }
  const tutorialDirectories = directChildDirectories(
    inventory,
    "20 Tutorials",
  ).filter((path) => !expectedPaths.has(path));
  if (expected.tutorialLayout !== undefined) {
    findings.push(
      ...tutorialDirectories.map((path) =>
        unapprovedFinding(path, "MF-TUTORIALS-001", "fail"),
      ),
    );
  }
  findings.push(
    ...directChildDirectories(inventory, "90 Resources")
      .filter(
        (path) =>
          path !== "90 Resources/00 Unclassified" && !expectedPaths.has(path),
      )
      .map((path) => unapprovedFinding(path, "MF-OPEN-001", "fail")),
  );
  for (const workspacePath of [
    "40 Projects and Labs/10 Projects",
    "40 Projects and Labs/20 Labs",
  ]) {
    if (!expectedPaths.has(workspacePath)) continue;
    findings.push(
      ...directChildren(inventory, workspacePath)
        .filter((path) => !expectedPaths.has(path))
        .map((path) => unapprovedFinding(path, "MF-WORKSPACES-001", "fail")),
    );
  }
  findings.push(
    ...inventory.entries
      .filter(
        ({ path }) =>
          !path.includes("/") &&
          path.startsWith("NTULearn_") &&
          !expected.rootPaths.has(path),
      )
      .map(({ path }) =>
        unapprovedFinding(path, "MF-IMPORTER-001", "requires-decision"),
      ),
  );
  return findings;
}

function directChildDirectories(
  inventory: Inventory,
  parent: string,
): string[] {
  const prefix = `${parent}/`;
  return inventory.entries
    .filter(
      ({ path, kind }) =>
        kind === "directory" &&
        path.startsWith(prefix) &&
        !path.slice(prefix.length).includes("/"),
    )
    .map(({ path }) => path)
    .sort();
}

function directChildren(inventory: Inventory, parent: string): string[] {
  const prefix = `${parent}/`;
  return inventory.entries
    .filter(
      ({ path }) =>
        path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
    )
    .map(({ path }) => path)
    .sort();
}

function unapprovedFinding(
  path: string,
  ruleId: string,
  status: "fail" | "requires-decision",
): Finding {
  return {
    ruleId,
    status,
    severity: status === "fail" ? "error" : "decision",
    path,
    evidence: `Inventory contains undeclared contextual entry ${path}.`,
    explanation:
      status === "fail"
        ? "The Module Definition excludes this controlled structure."
        : "The entry needs evidence-backed classification.",
    applicability:
      "Context-derived structure is controlled by the Module Definition.",
  };
}

function ruleFor(path: string): string {
  if (path.startsWith("20 Tutorials/")) return "MF-TUTORIALS-001";
  if (path.startsWith("30 Assessments/")) return "MF-ASSESSMENTS-001";
  if (path.startsWith("40 Projects and Labs/")) return "MF-WORKSPACES-001";
  if (path.startsWith("90 Resources/")) return "MF-OPEN-001";
  return "MF-IMPORTER-001";
}
