import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";

import type { ModuleControls } from "../conformance/index.js";
import { moduleControlPaths } from "../conformance/control-paths.js";
import { OperationalError } from "../operational-error.js";
import { isContainedBy } from "./is-contained-by.js";

export async function readModuleControls(
  moduleRoot: string,
): Promise<ModuleControls> {
  const entries = await Promise.all(
    Object.entries(moduleControlPaths).map(async ([name, relativePath]) => {
      const contents = await readOptionalControl(moduleRoot, relativePath);
      return contents === undefined ? undefined : [name, contents];
    }),
  );
  return Object.fromEntries(
    entries.filter((entry) => entry !== undefined),
  ) as ModuleControls;
}

async function readOptionalControl(
  root: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    let path = root;
    const components = relativePath.split("/");
    for (const [index, component] of components.entries()) {
      path = join(path, component);
      const metadata = await lstat(path);
      const final = index === components.length - 1;
      if (
        metadata.isSymbolicLink() ||
        (final ? !metadata.isFile() : !metadata.isDirectory()) ||
        !isContainedBy(root, await realpath(path))
      ) {
        return undefined;
      }
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isFile()) return undefined;
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await handle.readFile(),
      );
    } finally {
      await handle.close();
    }
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
