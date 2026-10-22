import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";

import { validateDefinition } from "../conformance/validate-definition.js";
import { OperationalError } from "../operational-error.js";
import { isContainedBy } from "./is-contained-by.js";
import { readSafeFile } from "./read-safe-file.js";
import { resolveTarget } from "./resolve-target.js";
import type { LocalConfig } from "./types.js";

type ImportDirectoryObservation =
  | { kind: "observed"; canonicalPath: string; directory: "present" | "absent" }
  | { kind: "unobserved"; error: { code: string; message: string } };

export async function observeModuleImportDestinations(
  config: LocalConfig,
): Promise<{
  roots: Array<{ destination: string; physical: ImportDirectoryObservation }>;
}> {
  const target = await resolveTarget(config);
  const source = await readSafeFile(
    target.moduleRoot,
    ["00 Module Admin", "10 Module Definition.yaml"],
    "Module Definition",
  );
  const validation = validateDefinition(source, target.module, target.semester);
  const problems = validation.findings.filter(
    ({ status }) => status !== "pass",
  );
  if (problems.length > 0) {
    throw new OperationalError(
      "invalid-target",
      `Module Definition is invalid for ${target.module}: ${problems.map(({ evidence }) => evidence).join(" ")}`,
    );
  }
  return {
    roots: await Promise.all(
      validation.importerRoots.map(async (destination) => ({
        destination,
        physical: await observeDirectory(target.moduleRoot, destination),
      })),
    ),
  };
}

async function observeDirectory(
  moduleRoot: string,
  destination: string,
): Promise<ImportDirectoryObservation> {
  const path = join(moduleRoot, destination);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new OperationalError(
        "symlink-target",
        `Importer root ${destination} is a symbolic link.`,
      );
    }
    if (!metadata.isDirectory()) {
      throw new OperationalError(
        "invalid-target",
        `Importer root ${destination} is not a directory.`,
      );
    }
    const canonicalPath = await realpath(path);
    if (!isContainedBy(moduleRoot, canonicalPath)) {
      throw new OperationalError(
        "out-of-root",
        `Importer root ${destination} resolves outside the Module.`,
      );
    }
    return { kind: "observed", canonicalPath, directory: "present" };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { kind: "observed", canonicalPath: path, directory: "absent" };
    }
    return {
      kind: "unobserved",
      error:
        error instanceof OperationalError
          ? { code: error.code, message: error.message }
          : {
              code: "operational-failure",
              message: `Importer root ${destination} cannot be inspected.`,
            },
    };
  }
}
