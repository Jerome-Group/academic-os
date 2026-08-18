import { readFile } from "node:fs/promises";

import {
  moduleContract,
  type ModuleContract,
} from "../conformance/module-contract.js";
import { OperationalError } from "../operational-error.js";
import {
  pinnedDocumentNames,
  seedTemplatePath,
  type PinnedDocumentBodies,
} from "./pinned-documents.js";

const seedTemplateRoot = new URL("../../../seed-templates/", import.meta.url);

export async function loadModuleContract(): Promise<ModuleContract> {
  return moduleContract(await readPinnedDocuments());
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
