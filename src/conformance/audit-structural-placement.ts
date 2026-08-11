import { basename } from "node:path";

import { universalStructurePaths } from "../contract/universal-structure.js";
import { assessmentHomes, controlPaths, fixedPaths } from "./contract-paths.js";
import type { ContextualStructure } from "./contextual-structure.js";
import {
  decisionFinding,
  deterministicFailure,
  withDeterministicPass,
} from "./finding.js";
import { directChildEntries } from "./inventory-paths.js";
import type { Finding, Inventory } from "./types.js";

export function auditStructuralPlacement(
  inventory: Inventory,
  context: ContextualStructure,
): Finding[] {
  return [
    ...fixedPathCaseFindings(inventory),
    ...moduleAdminFindings(inventory),
    ...assessmentFlatnessFindings(inventory),
    ...tutorialNestingFindings(inventory, context.tutorialLayout),
    ...controlledRootFindings(inventory, context.paths),
    ...misplacedControlFindings(inventory),
  ];
}

function fixedPathCaseFindings(inventory: Inventory): Finding[] {
  const failures = inventory.entries.flatMap(({ path }) => {
    const fixedPath = fixedPaths.get(path.toLowerCase());
    return fixedPath !== undefined && path !== fixedPath
      ? [
          deterministicFailure(
            "MF-NAMING-001",
            path,
            `Inventory contains ${path}; the fixed contract path is ${fixedPath}.`,
            "Fixed paths require exact numbering, spelling, and case.",
          ),
        ]
      : [];
  });
  return withDeterministicPass(
    failures,
    "MF-NAMING-001",
    ".",
    "Every observed fixed path uses exact contract spelling and case.",
    "Fixed-path naming applies wherever a contract path is present.",
  );
}

function moduleAdminFindings(inventory: Inventory): Finding[] {
  const failures = inventory.entries.flatMap(({ path, kind }) => {
    if (!path.startsWith("00 Module Admin/")) return [];
    const relativePath = path.slice("00 Module Admin/".length);
    if (kind !== "directory" || relativePath.includes("/")) return [];
    return [
      deterministicFailure(
        "MF-ADMIN-001",
        path,
        `Inventory contains the Module Admin subdirectory ${path}.`,
        "Module Admin is closed to subdirectories.",
      ),
    ];
  });
  const expectedControls = new Set(controlPaths.values());
  failures.push(
    ...inventory.entries
      .filter(
        ({ path, kind }) =>
          kind === "file" &&
          path.startsWith("00 Module Admin/") &&
          !path.slice("00 Module Admin/".length).includes("/") &&
          !expectedControls.has(path),
      )
      .map(({ path }) =>
        decisionFinding(
          "MF-ADMIN-001",
          path,
          `Inventory contains the additional flat Module Admin file ${path}.`,
          "A human decision is required to classify an additional admin control.",
        ),
      ),
  );
  return withDeterministicPass(
    failures,
    "MF-ADMIN-001",
    "00 Module Admin",
    "Module Admin has no subdirectories or unclassified flat controls.",
    "Module Admin is a closed control-file home.",
  );
}

function assessmentFlatnessFindings(inventory: Inventory): Finding[] {
  const failures = inventory.entries.flatMap(({ path, kind }) => {
    const home = [...assessmentHomes].find(
      (candidate) => path.startsWith(`${candidate}/`) || path === candidate,
    );
    if (home === undefined || path === home || kind !== "directory") return [];
    return [
      deterministicFailure(
        "MF-ASSESSMENTS-001",
        path,
        `Inventory contains nested assessment directory ${path}.`,
        "Assessment-category contents must remain flat.",
      ),
    ];
  });
  return withDeterministicPass(
    failures,
    "MF-ASSESSMENTS-001",
    "30 Assessments",
    "No assessment category contains a nested directory.",
    "Flatness applies only inside contract-defined assessment homes.",
  );
}

function tutorialNestingFindings(
  inventory: Inventory,
  layout: "flat" | "grouped" | undefined,
): Finding[] {
  if (layout !== "grouped") return [];
  return inventory.entries.flatMap(({ path, kind }) => {
    if (kind !== "directory" || !path.startsWith("20 Tutorials/")) return [];
    const relativePath = path.slice("20 Tutorials/".length);
    return relativePath.includes("/")
      ? [
          deterministicFailure(
            "MF-TUTORIALS-001",
            path,
            `Inventory contains nested directory ${path} below a declared Tutorial group.`,
            "A grouped Tutorial layout permits the declared source-derived groups, not deeper structural groups.",
          ),
        ]
      : [];
  });
}

function controlledRootFindings(
  inventory: Inventory,
  contextualPaths: string[],
): Finding[] {
  const expected = new Set([
    ...universalStructurePaths.map(([path]) => path),
    ...contextualPaths,
  ]);
  const caseVariants = new Set(
    inventory.entries.flatMap(({ path }) => {
      const fixedPath = fixedPaths.get(path.toLowerCase());
      return fixedPath !== undefined && fixedPath !== path ? [path] : [];
    }),
  );
  const failures: Finding[] = [];
  for (const parent of [
    "10 Learning Materials",
    "30 Assessments",
    "40 Projects and Labs",
  ]) {
    for (const entry of directChildEntries(inventory, parent)) {
      if (
        assessmentHomes.has(entry.path) ||
        entry.path === "40 Projects and Labs/10 Projects" ||
        entry.path === "40 Projects and Labs/20 Labs" ||
        expected.has(entry.path) ||
        caseVariants.has(entry.path)
      ) {
        continue;
      }
      const ruleId =
        parent === "40 Projects and Labs"
          ? "MF-WORKSPACES-001"
          : parent === "30 Assessments"
            ? "MF-ASSESSMENTS-001"
            : "MF-OPEN-001";
      failures.push(
        deterministicFailure(
          ruleId,
          entry.path,
          `Inventory contains undeclared direct entry ${entry.path}.`,
          `${parent} permits only its required or Definition-declared direct children; declared interiors remain open.`,
        ),
      );
    }
  }
  return failures;
}

function misplacedControlFindings(inventory: Inventory): Finding[] {
  return inventory.entries.flatMap(({ path, kind }) => {
    if (kind !== "file") return [];
    const name = basename(path);
    const expected = controlPaths.get(name);
    if (expected === undefined || expected === path) return [];
    return [
      deterministicFailure(
        "MF-NAMING-001",
        path,
        `Inventory contains control ${name} at ${path}; its required path is ${expected}.`,
        "Module controls have one exact contract-defined home.",
      ),
    ];
  });
}
