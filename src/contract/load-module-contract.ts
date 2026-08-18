import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  moduleContract,
  type ModuleContract,
} from "../conformance/module-contract.js";
import { OperationalError } from "../operational-error.js";
import {
  learningWorkspacePaths,
  learningWorkspaceRoot,
  type LearningWorkspaceFiles,
} from "./learning-workspace.js";
import {
  destinationPath,
  isSeedSourceTemplate,
  seedSourceTemplatePath,
} from "./seed-source-template-path.js";
import {
  pinnedDocumentNames,
  seedTemplatePath,
  type PinnedDocumentBodies,
} from "./pinned-documents.js";

// Three levels up because this file runs compiled, from `dist/src/contract/`.
const seedTemplateRoot = new URL("../../../seed-templates/", import.meta.url);

export async function loadModuleContract(): Promise<ModuleContract> {
  const [pinnedDocuments, learningWorkspaceFiles] = await Promise.all([
    readPinnedDocuments(),
    readLearningWorkspaceFiles(),
  ]);
  return moduleContract({ pinnedDocuments, learningWorkspaceFiles });
}

async function readPinnedDocuments(): Promise<PinnedDocumentBodies> {
  const bodies = await Promise.all(
    pinnedDocumentNames.map(async (name) => {
      const path = seedTemplatePath(name);
      try {
        return [name, await readFile(new URL(path, seedTemplateRoot), "utf8")];
      } catch {
        throw new OperationalError(
          "operational-failure",
          `Seed-source template cannot be read: seed-templates/${path}.`,
        );
      }
    }),
  );
  return Object.fromEntries(bodies) as PinnedDocumentBodies;
}

// Read from the directory rather than from a list, so a template added there reaches the next
// seeded module without a second edit. A module may diverge from its copy afterwards, which is why
// nothing audits one back — only the files MF-LEARNING-001 names have to be there at all.
async function readLearningWorkspaceFiles(): Promise<LearningWorkspaceFiles> {
  const root = fileURLToPath(
    new URL(`${learningWorkspaceRoot}/`, seedTemplateRoot),
  );
  let sourcePaths: string[];
  try {
    sourcePaths = (
      await readdir(root, { recursive: true, withFileTypes: true })
    )
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"),
      )
      .filter(isSeedSourceTemplate)
      .sort();
  } catch {
    throw new OperationalError(
      "operational-failure",
      `Seed-source templates cannot be read: seed-templates/${learningWorkspaceRoot}/.`,
    );
  }
  const bodies = await Promise.all(
    sourcePaths.map(async (path) => [
      `${learningWorkspaceRoot}/${destinationPath(path)}`,
      await readFile(join(root, path), "utf8"),
    ]),
  );
  const files = Object.fromEntries(bodies) as LearningWorkspaceFiles;
  const missing = learningWorkspacePaths
    .filter(([path, kind]) => kind === "file" && files[path] === undefined)
    .map(([path]) => seedSourceTemplatePath(path));
  if (missing.length > 0) {
    throw new OperationalError(
      "operational-failure",
      `Seed-source template cannot be read: ${missing.map((path) => `seed-templates/${path}`).join(", ")}.`,
    );
  }
  return files;
}
