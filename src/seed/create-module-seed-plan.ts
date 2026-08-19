import { parseDocument } from "yaml";

import type { ModuleContract } from "../conformance/module-contract.js";
import { validateDefinition } from "../conformance/validate-definition.js";
import { deriveContextualStructure } from "../conformance/contextual-structure.js";
import {
  interpolateModuleCode,
  pinnedDocumentNames,
  pinnedDocumentPaths,
} from "../contract/pinned-documents.js";
import type { SeedOperation, SeedPlan } from "./types.js";

// The module's list does not exist until `tasks provision` creates or adopts it, so the skeleton
// names no list: an absent header is what waiting for provisioning looks like, and provisioning
// is what writes the exact ID every later pull reads.
const seededTaskRegister = `# The module's Google Tasks list, mirrored. The live list is the authority; \`tasks provision\`
# writes its exact ID above these rows, and each pull rewrites what Google owns.
tasks: []
`;

// The workspace reads this file for what a unit is made of, so it is seeded declaring nothing
// rather than guessing units the module research has not confirmed yet.
const seededSourceMap = `# The module's Lecture-units, keyed exactly as the module numbers them.
# Each unit carries its topics, its lecture and textbook files, and its tutorials.
units: {}
`;

// A module that has cut no chapter yet says so, and the shelf the cuts come from is catalogued
// outside the folder: the register holds what this module took, and nothing about the books.
const seededTextbookRegister = `# The chapters this module has cut from the Textbook shelf, one entry per cut.
# Each cites a Book key in the shelf's own index and never repeats what that index holds.
extractions: []
`;

export function createModuleSeedPlan(input: {
  module: string;
  semester: string;
  profile: string;
  definition: string;
  contract: ModuleContract;
}): SeedPlan {
  const definition = readSeedDefinition(input);
  const contextualStructure = deriveContextualStructure(input.definition);
  const claude =
    "# Claude Code\n\nRead `AGENTS.md` completely before working in this module folder.\n";
  const context = `# ${input.module} — ${definition.title}\n\nPurpose: organise learning and work for ${input.module}.\n\n## Language\n`;
  const workspaceFiles = new Map(
    Object.entries(input.contract.learningWorkspaceFiles).map(
      ([path, body]): [string, string] => [
        path,
        interpolateModuleCode(body, input.module),
      ],
    ),
  );
  const workspaceStructure = new Set(
    input.contract.learningWorkspace.map(([path]) => path),
  );
  const contentsByPath = new Map<string, string>([
    ["00 Module Admin/00 Module Profile.md", input.profile],
    ["00 Module Admin/10 Module Definition.yaml", input.definition],
    ["00 Module Admin/20 Curation Register.jsonl", ""],
    ["00 Module Admin/30 Task Register.yaml", seededTaskRegister],
    ["00 Module Admin/40 Source Map.yaml", seededSourceMap],
    ["00 Module Admin/50 Textbook Register.yaml", seededTextbookRegister],
    ["CLAUDE.md", claude],
    ["CONTEXT.md", context],
    ...pinnedDocumentNames.map((name): [string, string] => [
      pinnedDocumentPaths[name],
      interpolateModuleCode(input.contract.pinnedDocuments[name], input.module),
    ]),
  ]);
  return {
    module: input.module,
    semester: input.semester,
    blockers: definition.blockers,
    operations: [
      ...structureOperations(input.contract.universalStructure, contentsByPath),
      ...structureOperations(input.contract.learningWorkspace, workspaceFiles),
      ...[...workspaceFiles]
        .filter(([path]) => !workspaceStructure.has(path))
        .map(([path, contents]) => ({ kind: "file" as const, path, contents })),
      ...contextualStructure.paths.map((path) => ({
        kind: "directory" as const,
        path,
      })),
    ],
  };
}

function structureOperations(
  structure: ReadonlyArray<readonly [string, "directory" | "file"]>,
  bodies: ReadonlyMap<string, string>,
): SeedOperation[] {
  return structure.map(([path, kind]) => ({
    kind,
    path,
    ...(kind === "file" ? { contents: bodies.get(path) ?? "" } : {}),
  }));
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
