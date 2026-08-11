import { parseDocument } from "yaml";

import { validateDefinition } from "../conformance/validate-definition.js";
import { deriveContextualStructure } from "../conformance/contextual-structure.js";
import { universalStructurePaths } from "../contract/universal-structure.js";
import type { SeedPlan } from "./types.js";

export function createModuleSeedPlan(input: {
  module: string;
  semester: string;
  profile: string;
  definition: string;
}): SeedPlan {
  const definition = readSeedDefinition(input);
  const contextualStructure = deriveContextualStructure(input.definition);
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
    operations: [
      ...universalStructurePaths.map(([path, kind]) => ({
        kind,
        path,
        ...(kind === "file"
          ? { contents: contentsByPath.get(path) ?? "" }
          : {}),
      })),
      ...contextualStructure.paths.map((path) => ({
        kind: "directory" as const,
        path,
      })),
    ],
  };
}

function readSeedDefinition(input: {
  module: string;
  semester: string;
  definition: string;
}): {
  title: string;
  blockers: string[];
} {
  const document = parseDocument(input.definition, {
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
    return {
      title: "Unresolved Module Title",
      blockers: [
        "Definition is malformed or lacks a module title; requires a human decision before seeding.",
      ],
    };
  }
  const validation = validateDefinition(
    input.definition,
    input.module,
    input.semester,
  );
  return {
    title: value.module.title,
    blockers: validation.findings
      .filter(({ status }) => status !== "pass")
      .map(
        ({ status, evidence }) =>
          `Definition ${status}; requires a human decision before seeding: ${evidence}`,
      ),
  };
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
