import { parseDocument } from "yaml";

import { isDirectoryName, isRecord, nonEmptyString } from "./value-shape.js";

export interface ContextualStructure {
  paths: string[];
  rootPaths: Set<string>;
  importerRoots: Set<string>;
  tutorialLayout?: "flat" | "grouped";
}

const assessmentPaths = {
  quizzes: "30 Assessments/10 Quizzes",
  tests: "30 Assessments/20 Tests",
  assignments: "30 Assessments/50 Assignments",
} as const;
const workspacePaths = {
  projects: "40 Projects and Labs/10 Projects",
  labs: "40 Projects and Labs/20 Labs",
} as const;
const workspaceChildren = [
  "10 Briefs",
  "20 References",
  "30 Working",
  "40 Data",
  "50 Submissions",
] as const;

export function deriveContextualStructure(
  definitionSource: string | undefined,
): ContextualStructure {
  if (definitionSource === undefined)
    return {
      paths: [],
      rootPaths: new Set(),
      importerRoots: new Set(["NTULearn"]),
    };
  const document = parseDocument(definitionSource, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  const value: unknown = document.toJS();
  if (document.errors.length > 0 || !isRecord(value)) {
    return {
      paths: [],
      rootPaths: new Set(),
      importerRoots: new Set(["NTULearn"]),
    };
  }
  const structure = isRecord(value.structure) ? value.structure : {};
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const paths: string[] = [];
  const importerRoots = new Set(["NTULearn"]);
  const tutorials = isRecord(structure.tutorials) ? structure.tutorials : {};
  if (
    tutorials.layout === "grouped" &&
    hasApprovedEvidence(tutorials, evidence) &&
    Array.isArray(tutorials.groups)
  ) {
    for (const group of tutorials.groups) {
      if (isDirectoryName(group)) paths.push(`20 Tutorials/${group}`);
    }
  }
  const assessments = isRecord(structure.assessments)
    ? structure.assessments
    : {};
  for (const [name, path] of Object.entries(assessmentPaths)) {
    if (
      isRecord(assessments[name]) &&
      assessments[name].enabled === true &&
      hasApprovedEvidence(assessments[name], evidence)
    ) {
      paths.push(path);
    }
  }
  for (const [name, path] of Object.entries(workspacePaths)) {
    if (
      isRecord(structure[name]) &&
      structure[name].enabled === true &&
      hasApprovedEvidence(structure[name], evidence)
    ) {
      paths.push(path, ...workspaceChildren.map((child) => `${path}/${child}`));
    }
  }
  if (Array.isArray(structure.resource_categories)) {
    for (const category of structure.resource_categories) {
      if (
        isRecord(category) &&
        isDirectoryName(category.name) &&
        hasApprovedEvidence(category, evidence)
      ) {
        paths.push(`90 Resources/${category.name}`);
      }
    }
  }
  const sources = isRecord(value.sources) ? value.sources : {};
  if (Array.isArray(sources.ntulearn)) {
    for (const importer of sources.ntulearn) {
      if (
        isRecord(importer) &&
        isDirectoryName(importer.destination) &&
        hasApprovedEvidence(importer, evidence) &&
        importer.destination !== "NTULearn"
      ) {
        importerRoots.add(importer.destination);
        if (importer.destination !== "NTULearn") {
          paths.push(importer.destination);
        }
      }
    }
  }
  const orderedPaths = [...new Set(paths)];
  return {
    paths: orderedPaths,
    rootPaths: new Set(orderedPaths.filter((path) => !path.includes("/"))),
    importerRoots,
    ...(["flat", "grouped"].includes(String(tutorials.layout))
      ? { tutorialLayout: tutorials.layout as "flat" | "grouped" }
      : {}),
  };
}

function hasApprovedEvidence(
  declaration: Record<string, unknown>,
  evidence: Record<string, unknown>,
): boolean {
  return (
    Array.isArray(declaration.evidence) &&
    declaration.evidence.length > 0 &&
    declaration.evidence.every(
      (reference) => nonEmptyString(reference) && isRecord(evidence[reference]),
    )
  );
}
