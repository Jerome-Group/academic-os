import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { isContainedBy } from "./is-contained-by.js";
import { OperationalError } from "./operational-error.js";
import { resolveConfiguredRoots } from "./resolve-configured-roots.js";
import type { LocalConfig, ResolvedTarget } from "./types.js";

export async function resolveTarget(
  config: LocalConfig,
): Promise<ResolvedTarget> {
  const { driveMount, stateRoot, semesterRoot } =
    await resolveConfiguredRoots(config);

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
