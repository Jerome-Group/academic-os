import { posix } from "node:path";

import { learningWorkspacePaths } from "../contract/learning-workspace.js";
import { universalStructurePaths } from "../contract/universal-structure.js";
import { isGovernedControlHome, moduleControlPaths } from "./control-paths.js";

// Every control a naming rule reaches, keyed by the file name that rule sees. Sorted, so the map
// does not inherit its order from however `moduleControlPaths` happens to be spelled out.
export const controlPaths = new Map<string, string>(
  Object.values<string>(moduleControlPaths)
    .filter(isGovernedControlHome)
    .sort()
    .map((path) => [posix.basename(path), path]),
);

export const fixedPaths = new Map(
  [...universalStructurePaths, ...learningWorkspacePaths].map(([path]) => [
    path.toLowerCase(),
    path,
  ]),
);

export const assessmentHomes = new Set([
  "30 Assessments/10 Quizzes",
  "30 Assessments/20 Tests",
  "30 Assessments/30 Midterms",
  "30 Assessments/40 Finals",
  "30 Assessments/50 Assignments",
]);

export const curatedRoots = [
  "10 Learning Materials",
  "20 Tutorials",
  "30 Assessments",
  "40 Projects and Labs",
  "90 Resources",
];
