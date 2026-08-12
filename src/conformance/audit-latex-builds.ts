import { basename, dirname, extname } from "node:path";

import { deterministicFailure, withDeterministicPass } from "./finding.js";
import { isInsideRoot } from "./inventory-paths.js";
import type { Finding, Inventory } from "./types.js";

export function auditLatexBuilds(
  inventory: Inventory,
  importerRoots: ReadonlySet<string>,
): Finding[] {
  const builds = inventory.entries
    .filter(
      ({ path, kind }) =>
        kind === "directory" &&
        basename(path) === "build" &&
        ![...importerRoots].some((root) => isInsideRoot(path, root)),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
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
    if (isInsideRoot(path, ".scratch")) {
      return [
        deterministicFailure(
          "MF-LATEX-001",
          path,
          `Inventory contains build output inside .scratch at ${path}.`,
          "LaTeX build directories may not live inside .scratch.",
        ),
      ];
    }
    const workspace = dirname(path);
    const hasLatexSource = inventory.entries.some(
      ({ path: candidate, kind }) =>
        kind === "file" &&
        extname(candidate).toLowerCase() === ".tex" &&
        isInsideRoot(candidate, workspace) &&
        !isInsideRoot(candidate, path),
    );
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
    `All ${builds.length} observed build directories are workspace-local and outside .scratch.`,
    "LaTeX build placement applies whenever a non-importer build directory exists.",
  );
}
