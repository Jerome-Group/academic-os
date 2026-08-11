import { basename, posix } from "node:path";

import { controlPaths, curatedRoots } from "./contract-paths.js";
import {
  decisionFinding,
  deterministicFailure,
  withDeterministicPass,
} from "./finding.js";
import { isInsideRoot } from "./inventory-paths.js";
import type { Finding, Inventory } from "./types.js";

export function auditCuratedNaming(
  inventory: Inventory,
  importerRoots: ReadonlySet<string>,
): Finding[] {
  const governedFiles = inventory.entries.filter(
    ({ path, kind }) =>
      kind === "file" &&
      isCuratedPath(path) &&
      !isExemptPath(path, importerRoots) &&
      !controlPaths.has(basename(path)),
  );
  const deterministic = governedFiles.flatMap(({ path }) =>
    isCuratedFileName(basename(path), inventory.moduleCode)
      ? []
      : [
          deterministicFailure(
            "MF-NAMING-002",
            path,
            `Curated filename ${basename(path)} does not match ${inventory.moduleCode}_Title_Case.ext with supported sequence, year, and date tokens.`,
            "Curated academic files require the module prefix, at least one Title Case token, optional numeric qualifiers, and a lowercase extension.",
          ),
        ],
  );
  return [
    ...withDeterministicPass(
      deterministic,
      "MF-NAMING-002",
      ".",
      `All ${governedFiles.length} governed curated files use contract names.`,
      "Naming applies only to curated academic homes, excluding controls, importers, open roots, and build outputs.",
    ),
    ...governedFiles.flatMap(({ path }) => judgmentNameFindings(path)),
  ];
}

function judgmentNameFindings(path: string): Finding[] {
  const name = basename(path);
  const discouraged = name.match(/(?:\(1\)|copy|final-final)/iu)?.[0];
  const qualifier =
    discouraged ?? (hasFinalVersionSuffix(name) ? "Final" : undefined);
  if (qualifier === undefined) return [];
  return [
    decisionFinding(
      "MF-NAMING-003",
      path,
      `Curated filename ${name} contains discouraged qualifier ${JSON.stringify(qualifier)}.`,
      "A human decision is required to compare duplicates or choose a meaningful qualifier.",
    ),
  ];
}

function isCuratedPath(path: string): boolean {
  return curatedRoots.some((root) => isInsideRoot(path, root));
}

function isExemptPath(
  path: string,
  importerRoots: ReadonlySet<string>,
): boolean {
  return (
    [...importerRoots].some((root) => isInsideRoot(path, root)) ||
    path.split("/").includes("build")
  );
}

function isCuratedFileName(name: string, moduleCode: string): boolean {
  const extension = posix.extname(name);
  if (!/^\.[a-z0-9]+$/u.test(extension)) return false;
  const stem = name.slice(0, -extension.length);
  if (!stem.startsWith(`${moduleCode}_`)) return false;
  const tokens = stem.slice(moduleCode.length + 1).split("_");
  const titleCase = (token: string) => /^[A-Z][a-z0-9]*$/u.test(token);
  const numericQualifier = (token: string) =>
    /^\d{2}$/u.test(token) ||
    /^\d{4}$/u.test(token) ||
    /^\d{4}-\d{2}-\d{2}$/u.test(token);
  return (
    tokens.some(titleCase) &&
    tokens.every((token) => titleCase(token) || numericQualifier(token))
  );
}

function hasFinalVersionSuffix(name: string): boolean {
  const stem = name.slice(0, -posix.extname(name).length);
  const tokens = stem.split("_").slice(1);
  return tokens.length > 1 && tokens.at(-1) === "Final";
}
