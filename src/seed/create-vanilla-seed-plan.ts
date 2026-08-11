import { parseDocument } from "yaml";

import { universalStructurePaths } from "../contract/universal-structure.js";
import type { SeedPlan } from "./types.js";

export function createVanillaSeedPlan(input: {
  module: string;
  semester: string;
  profile: string;
  definition: string;
}): SeedPlan {
  const definition = readVanillaDefinition(input.definition);
  const agents = agentsControl(input.module);
  const claude =
    "# Claude Code\n\nRead `AGENTS.md` completely before working in this module folder.\n";
  const context = `# ${input.module} — ${definition.title}\n\nPurpose: organise learning and work for ${input.module}.\n\n## Language\n`;
  const contentsByPath = new Map<string, string>([
    ["00 Module Admin/00 Module Profile.md", input.profile],
    ["00 Module Admin/10 Module Definition.yaml", input.definition],
    ["00 Module Admin/20 Curation Register.jsonl", ""],
    ["AGENTS.md", agents],
    ["CLAUDE.md", claude],
    ["CONTEXT.md", context],
  ]);
  return {
    module: input.module,
    semester: input.semester,
    blockers: definition.blockers,
    operations: universalStructurePaths.map(([path, kind]) => ({
      kind,
      path,
      ...(kind === "file" ? { contents: contentsByPath.get(path) ?? "" } : {}),
    })),
  };
}

function readVanillaDefinition(source: string): {
  title: string;
  blockers: string[];
} {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  const value: unknown = document.toJS();
  if (
    document.errors.length > 0 ||
    typeof value !== "object" ||
    value === null ||
    !("module" in value) ||
    typeof value.module !== "object" ||
    value.module === null ||
    !("title" in value.module) ||
    typeof value.module.title !== "string" ||
    value.module.title.length === 0
  ) {
    return { title: "Unresolved Module Title", blockers: [] };
  }
  const root = record(value);
  const blockers: string[] = [];
  const structure = record(root.structure);
  const assessments = record(structure.assessments);
  for (const category of ["quizzes", "tests", "assignments"]) {
    if (record(assessments[category]).enabled !== false) {
      blockers.push(
        `Vanilla seed requires structure.assessments.${category}.enabled to be false; context-derived seeding is issue #13.`,
      );
    }
  }
  for (const workspace of ["projects", "labs"]) {
    if (record(structure[workspace]).enabled !== false) {
      blockers.push(
        `Vanilla seed requires structure.${workspace}.enabled to be false; context-derived seeding is issue #13.`,
      );
    }
  }
  if (
    !Array.isArray(structure.resource_categories) ||
    structure.resource_categories.length > 0
  ) {
    blockers.push(
      "Vanilla seed requires structure.resource_categories to be empty; context-derived seeding is issue #13.",
    );
  }
  const ntulearn = record(root.sources).ntulearn;
  if (
    !Array.isArray(ntulearn) ||
    ntulearn.length !== 1 ||
    record(ntulearn[0]).destination !== "NTULearn"
  ) {
    blockers.push(
      "Vanilla seed supports only the universal NTULearn importer root; context-derived seeding is issue #13.",
    );
  }
  return { title: value.module.title, blockers };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function agentsControl(module: string): string {
  return `# What this folder is
${module} module folder.

## Start here
Read \`CONTEXT.md\` and \`00 Module Admin/00 Module Profile.md\`.

## Routes
- Learning: \`70 Learning/\`
- Tutorials: \`20 Tutorials/\`
- Curation: \`00 Module Admin/20 Curation Register.jsonl\`
- Assessments: \`30 Assessments/\`
- Projects/Labs: \`40 Projects and Labs/\`
- Maintenance: \`00 Module Admin/10 Module Definition.yaml\`

## Safety
Preserve importer sources and request decisions for ambiguity.

## Updating these instructions
Show proposed changes for approval before applying them.
`;
}
