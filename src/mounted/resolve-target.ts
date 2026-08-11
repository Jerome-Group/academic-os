import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { OperationalError } from "./operational-error.js";
import type { LocalConfig, ResolvedTarget } from "./types.js";

export async function resolveTarget(
  config: LocalConfig,
): Promise<ResolvedTarget> {
  validateConfigValues(config);

  const driveMount = await existingDirectory(config.driveMount, "drive-mount");
  const stateRoot = await existingDirectory(config.stateRoot, "state-root");
  const configuredSemesterRoot = config.semesterRoots[config.semester];
  if (configuredSemesterRoot === undefined) {
    throw new OperationalError(
      "missing-semester-root",
      `No semester root is configured for ${config.semester}.`,
    );
  }
  if (
    typeof configuredSemesterRoot !== "string" ||
    configuredSemesterRoot.length === 0
  ) {
    throw new OperationalError(
      "invalid-config",
      `Semester root for ${config.semester} must be a non-empty string.`,
    );
  }
  if (isAbsolute(configuredSemesterRoot)) {
    throw new OperationalError(
      "out-of-root",
      "A semester root must be relative to the configured Drive mount.",
    );
  }

  const semesterCandidate = join(driveMount, configuredSemesterRoot);
  if (!isContainedBy(driveMount, semesterCandidate)) {
    throw new OperationalError(
      "out-of-root",
      `The configured semester root escapes the Drive mount: ${configuredSemesterRoot}.`,
    );
  }
  const semesterRoot = await existingDirectory(
    semesterCandidate,
    "semester-root",
  );
  if (!isContainedBy(driveMount, semesterRoot)) {
    throw new OperationalError(
      "out-of-root",
      "The resolved semester root escapes the Drive mount.",
    );
  }

  const semesterEntries = await readdir(semesterRoot, { withFileTypes: true });
  const candidates = semesterEntries.filter(
    ({ name }) => name.toUpperCase() === config.module,
  );
  if (candidates.length === 0) {
    throw new OperationalError(
      "missing-target",
      `Module ${config.module} is not a direct child of ${config.semester}.`,
    );
  }
  if (candidates.length > 1) {
    throw new OperationalError(
      "ambiguous-target",
      `Multiple targets differ only by case for ${config.module}: ${candidates
        .map(({ name }) => name)
        .sort()
        .join(", ")}.`,
    );
  }

  const candidate = candidates[0];
  if (candidate === undefined) {
    throw new OperationalError(
      "missing-target",
      `Module ${config.module} is missing.`,
    );
  }
  if (candidate.name !== config.module) {
    throw new OperationalError(
      "case-variant-target",
      `Expected ${config.module}, found case variant ${candidate.name}.`,
    );
  }

  const moduleCandidate = join(semesterRoot, candidate.name);
  const candidateMetadata = await lstat(moduleCandidate);
  if (candidateMetadata.isSymbolicLink()) {
    throw new OperationalError(
      "symlink-target",
      `Module target ${config.module} is a symbolic link.`,
    );
  }
  if (!candidateMetadata.isDirectory()) {
    throw new OperationalError(
      "invalid-target",
      `Module target ${config.module} is not a directory.`,
    );
  }

  const moduleRoot = await realpath(moduleCandidate);
  if (!isContainedBy(semesterRoot, moduleRoot)) {
    throw new OperationalError(
      "out-of-root",
      `Module target ${config.module} resolves outside its semester root.`,
    );
  }

  return {
    driveMount,
    stateRoot,
    semesterRoot,
    moduleRoot,
    semester: config.semester,
    module: config.module,
  };
}

function validateConfigValues(config: LocalConfig): void {
  for (const [name, value] of [
    ["driveMount", config.driveMount],
    ["stateRoot", config.stateRoot],
    ["semester", config.semester],
    ["module", config.module],
  ]) {
    if (typeof value !== "string" || value.length === 0) {
      throw new OperationalError(
        "invalid-config",
        `${name} must be a non-empty string.`,
      );
    }
  }
  if (!isAbsolute(config.driveMount) || !isAbsolute(config.stateRoot)) {
    throw new OperationalError(
      "invalid-config",
      "driveMount and stateRoot must be absolute paths.",
    );
  }
  if (
    config.module !== config.module.toUpperCase() ||
    config.module === "." ||
    config.module === ".." ||
    config.module.includes("/") ||
    config.module.includes("\\")
  ) {
    throw new OperationalError(
      "invalid-config",
      `Module must be an uppercase module code, received ${config.module}.`,
    );
  }
  if (
    typeof config.semesterRoots !== "object" ||
    config.semesterRoots === null ||
    Array.isArray(config.semesterRoots)
  ) {
    throw new OperationalError(
      "invalid-config",
      "semesterRoots must be an object.",
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
    if (error instanceof OperationalError) {
      throw error;
    }
    throw new OperationalError(
      "invalid-config",
      `Configured ${role} cannot be resolved: ${path}.`,
    );
  }
}

function isContainedBy(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}
