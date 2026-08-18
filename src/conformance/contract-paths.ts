import { learningWorkspacePaths } from "../contract/learning-workspace.js";
import { universalStructurePaths } from "../contract/universal-structure.js";

export const controlPaths = new Map([
  ["00 Module Profile.md", "00 Module Admin/00 Module Profile.md"],
  ["10 Module Definition.yaml", "00 Module Admin/10 Module Definition.yaml"],
  ["20 Curation Register.jsonl", "00 Module Admin/20 Curation Register.jsonl"],
  ["40 Source Map.yaml", "00 Module Admin/40 Source Map.yaml"],
  ["AGENTS.md", "AGENTS.md"],
  ["CLAUDE.md", "CLAUDE.md"],
  ["CONTEXT.md", "CONTEXT.md"],
]);

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
