import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ResearchProjectContract,
  researchProjectContract,
} from "../conformance/research-project-contract.js";
import { OperationalError } from "../operational-error.js";
import { researchProjectUniversalStructure } from "./research-project-structure.js";
import {
  destinationPath,
  isSeedSourceTemplate,
  seedSourceTemplatePath,
} from "./seed-source-template-path.js";

const templateRoot = new URL(
  "../../../seed-templates/research-project/",
  import.meta.url,
);

export async function loadResearchProjectContract(): Promise<ResearchProjectContract> {
  const root = fileURLToPath(templateRoot);
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
      "Research seed-source templates cannot be read: seed-templates/research-project/.",
    );
  }
  const seedFiles = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        destinationPath(path),
        await readFile(join(root, path), "utf8"),
      ]),
    ),
  );
  const requiredFiles = researchProjectUniversalStructure
    .filter(([, kind]) => kind === "file")
    .map(([path]) => path);
  const missing = requiredFiles.filter((path) => seedFiles[path] === undefined);
  const expected = new Set<string>(requiredFiles);
  const unexpected = Object.keys(seedFiles).filter(
    (path) => !expected.has(path),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      ...(missing.length === 0
        ? []
        : [`missing ${missing.map(seedSourceTemplatePath).join(", ")}`]),
      ...(unexpected.length === 0
        ? []
        : [`unrecognized ${unexpected.join(", ")}`]),
    ].join("; ");
    throw new OperationalError(
      "operational-failure",
      `Research seed-source template set is incomplete: ${details}.`,
    );
  }
  return researchProjectContract(seedFiles);
}
