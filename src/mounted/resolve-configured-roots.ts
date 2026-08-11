import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { OperationalError } from "./operational-error.js";
import type { LocalConfig } from "./types.js";

export interface ResolvedConfiguredRoots {
  driveMount: string;
  stateRoot: string;
  semesterRoot: string;
}

export async function resolveConfiguredRoots(
  config: LocalConfig,
): Promise<ResolvedConfiguredRoots> {
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
  return { driveMount, stateRoot, semesterRoot };
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
  if (!/^[A-Z]{2,4}\d{4}[A-Z]?$/u.test(config.module)) {
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
    if (error instanceof OperationalError) throw error;
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
