import { basename, dirname, extname } from "node:path";

import { deterministicFailure, withDeterministicPass } from "./finding.js";
import { isInsideRoot } from "./inventory-paths.js";
import type { Finding, Inventory } from "./types.js";

export function auditLatexBuilds(
  inventory: Inventory,
  importerRoots: ReadonlySet<string>,
): Finding[] {
  const excludedRoots = [...importerRoots];
  const builds = inventory.entries
    .filter(
      ({ path, kind }) =>
        kind === "directory" &&
        basename(path) === "build" &&
        !excludedRoots.some((root) => isInsideRoot(path, root)),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const sourcesByDirectory =
    builds.length === 0
      ? new Map<string, number>()
      : latexSourceCounts(inventory);
  const failures = builds.flatMap(({ path }): Finding[] => {
    if (path === "build") {
      return [
        deterministicFailure(
          "MF-LATEX-001",
          path,
          "Inventory contains a module-root build directory.",
          "A module-root build is not a universal seed and is prohibited.",
        ),
      ];
    }
    if (isInsideRoot(path, ".scratch")) return [];
    const workspace = dirname(path);
    const hasLatexSource =
      (sourcesByDirectory.get(workspace) ?? 0) >
      (sourcesByDirectory.get(path) ?? 0);
    if (!hasLatexSource) {
      return [
        deterministicFailure(
          "MF-LATEX-001",
          path,
          `Inventory contains ${path} without LaTeX source in ${workspace}.`,
          "A build directory belongs only inside a compilation workspace containing LaTeX source.",
        ),
      ];
    }
    return [];
  });
  return withDeterministicPass(
    failures,
    "MF-LATEX-001",
    ".",
    `All ${builds.length} observed build directories are workspace-local or disposable output inside .scratch.`,
    "LaTeX build placement applies whenever a non-importer build directory exists.",
  );
}

function latexSourceCounts(inventory: Inventory): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of inventory.entries) {
    if (entry.kind !== "file" || extname(entry.path).toLowerCase() !== ".tex")
      continue;
    let directory = dirname(entry.path);
    while (directory !== ".") {
      counts.set(directory, (counts.get(directory) ?? 0) + 1);
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return counts;
}
