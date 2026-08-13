import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OperationalError } from "./operational-error.js";
import { isContainedBy } from "./is-contained-by.js";
import type { LocalConfig } from "./types.js";

export interface ResolvedConfiguredRoots {
  driveMount: string;
  stateRoot: string;
  semesterRoot: string;
}

export interface ConfiguredSemesterRoots {
  driveMount: string;
  stateRoot: string;
  semester: string;
  semesterRoot: string;
}

export async function resolveConfiguredRoots(
  config: LocalConfig,
): Promise<ResolvedConfiguredRoots> {
  validateConfigValues(config);
  const configuredSemesterRoot = config.semesterRoots[config.semester];
  if (configuredSemesterRoot === undefined) {
    throw new OperationalError(
      "missing-semester-root",
      `No semester root is configured for ${config.semester}.`,
    );
  }
  return await resolveConfiguredSemesterRoots({
    driveMount: config.driveMount,
    stateRoot: config.stateRoot,
    semester: config.semester,
    semesterRoot: configuredSemesterRoot,
  });
}

export async function resolveConfiguredSemesterRoots(
  config: ConfiguredSemesterRoots,
): Promise<ResolvedConfiguredRoots> {
  validateRootValues(config);
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
  if (
    typeof config.semesterRoot !== "string" ||
    config.semesterRoot.length === 0
  ) {
    throw new OperationalError(
      "invalid-config",
      `Semester root for ${config.semester} must be a non-empty string.`,
    );
  }
  if (isAbsolute(config.semesterRoot)) {
    throw new OperationalError(
      "out-of-root",
      "A semester root must be relative to the configured Drive mount.",
    );
  }
  const semesterCandidate = join(driveMount, config.semesterRoot);
  if (!isContainedBy(driveMount, semesterCandidate)) {
    throw new OperationalError(
      "out-of-root",
      `The configured semester root escapes the Drive mount: ${config.semesterRoot}.`,
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
  validateRootValues({
    driveMount: config.driveMount,
    stateRoot: config.stateRoot,
    semester: config.semester,
    semesterRoot: config.semesterRoots?.[config.semester] ?? "",
  });
  if (typeof config.module !== "string" || config.module.length === 0) {
    throw new OperationalError(
      "invalid-config",
      "module must be a non-empty string.",
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

function validateRootValues(config: ConfiguredSemesterRoots): void {
  for (const [name, value] of [
    ["driveMount", config.driveMount],
    ["stateRoot", config.stateRoot],
    ["semester", config.semester],
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
