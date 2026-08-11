import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ModuleControls } from "../conformance/index.js";
import { moduleControlPaths } from "../conformance/control-paths.js";
import { OperationalError } from "./operational-error.js";

export async function readModuleControls(
  moduleRoot: string,
): Promise<ModuleControls> {
  const entries = await Promise.all(
    Object.entries(moduleControlPaths).map(async ([name, relativePath]) => {
      const contents = await readOptionalControl(
        join(moduleRoot, relativePath),
        relativePath,
      );
      return contents === undefined ? undefined : [name, contents];
    }),
  );
  return Object.fromEntries(
    entries.filter((entry) => entry !== undefined),
  ) as ModuleControls;
}

async function readOptionalControl(
  path: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      isNodeError(error) &&
      ["ENOENT", "EISDIR", "ELOOP"].includes(error.code ?? "")
    ) {
      return undefined;
    }
    throw new OperationalError(
      "operational-failure",
      `Control cannot be read: ${relativePath}.`,
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
