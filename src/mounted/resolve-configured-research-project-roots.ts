import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveConfiguredResearchProject,
  type AcademicConfig,
  type ResolvedResearchProject,
} from "../config/index.js";
import { OperationalError } from "../operational-error.js";
import { isContainedBy } from "./is-contained-by.js";

export interface ResolvedConfiguredResearchProjectRoots {
  driveMount: string;
  stateRoot: string;
  researchRoot: string;
  projectRoot: string;
  project: ResolvedResearchProject;
}

export async function resolveConfiguredResearchProjectRoots(
  config: AcademicConfig,
  key: string,
  options: { requireProject?: boolean } = {},
): Promise<ResolvedConfiguredResearchProjectRoots> {
  const project = resolveConfiguredResearchProject(config, key);
  validateAbsoluteRoots(config.driveMount, config.stateRoot);
  const driveMount = await existingDirectory(config.driveMount, "drive-mount");
  const stateRoot = await existingDirectory(config.stateRoot, "state-root");
  const repositoryRoot = await realpath(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  if (
    isContainedBy(driveMount, stateRoot) ||
    isContainedBy(repositoryRoot, stateRoot)
  ) {
    throw new OperationalError(
      "unsafe-state-root",
      "Private state must be outside the Drive mount and tracked repository.",
    );
  }

  const researchCandidate = join(driveMount, project.root);
  if (!isContainedBy(driveMount, researchCandidate)) {
    throw new OperationalError(
      "out-of-root",
      `The configured research root escapes the Drive mount: ${project.root}.`,
    );
  }
  const researchRoot = await existingDirectory(
    researchCandidate,
    "research-root",
  );
  if (!isContainedBy(driveMount, researchRoot)) {
    throw new OperationalError(
      "out-of-root",
      "The resolved research root escapes the Drive mount.",
    );
  }

  const candidates = (await readdir(researchRoot, { withFileTypes: true }))
    .filter(({ name }) => name.toUpperCase() === project.folder.toUpperCase())
    .sort((left, right) => left.name.localeCompare(right.name));
  if (candidates.length > 1) {
    throw new OperationalError(
      "ambiguous-target",
      `Multiple research targets differ only by case for ${project.folder}: ${candidates
        .map(({ name }) => name)
        .join(", ")}.`,
    );
  }
  const candidate = candidates[0];
  if (candidate === undefined) {
    if (options.requireProject === true) {
      throw new OperationalError(
        "missing-target",
        `Research project ${project.folder} is not a direct child of ${project.root}.`,
      );
    }
    return {
      driveMount,
      stateRoot,
      researchRoot,
      projectRoot: join(researchRoot, project.folder),
      project,
    };
  }
  if (candidate.name !== project.folder) {
    throw new OperationalError(
      "case-variant-target",
      `Expected ${project.folder}, found case variant ${candidate.name}.`,
    );
  }
  const projectCandidate = join(researchRoot, candidate.name);
  const metadata = await lstat(projectCandidate);
  if (metadata.isSymbolicLink()) {
    throw new OperationalError(
      "symlink-target",
      `Research project target ${project.folder} is a symbolic link.`,
    );
  }
  if (!metadata.isDirectory()) {
    throw new OperationalError(
      "invalid-target",
      `Research project target ${project.folder} is not a directory.`,
    );
  }
  const projectRoot = await realpath(projectCandidate);
  if (!isContainedBy(researchRoot, projectRoot)) {
    throw new OperationalError(
      "out-of-root",
      `Research project target ${project.folder} resolves outside its research root.`,
    );
  }
  return { driveMount, stateRoot, researchRoot, projectRoot, project };
}

function validateAbsoluteRoots(driveMount: string, stateRoot: string): void {
  if (
    typeof driveMount !== "string" ||
    driveMount.length === 0 ||
    typeof stateRoot !== "string" ||
    stateRoot.length === 0 ||
    !isAbsolute(driveMount) ||
    !isAbsolute(stateRoot)
  ) {
    throw new OperationalError(
      "invalid-config",
      "driveMount and stateRoot must be absolute paths.",
    );
  }
}

async function existingDirectory(path: string, role: string): Promise<string> {
  try {
    const resolved = await realpath(path);
    const metadata = await lstat(resolved);
    if (!metadata.isDirectory()) {
      throw new OperationalError(
        "invalid-config",
        `Configured ${role} is not a directory: ${path}.`,
      );
    }
    return resolved;
  } catch (error) {
    if (error instanceof OperationalError) throw error;
    throw new OperationalError(
      "invalid-config",
      `Configured ${role} cannot be resolved: ${path}.`,
    );
  }
}
