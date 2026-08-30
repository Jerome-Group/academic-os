import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type ResearchProjectControls,
  researchProjectControlPaths,
} from "../conformance/research-project-control-paths.js";
import { OperationalError } from "../operational-error.js";

export async function readResearchProjectControls(
  projectRoot: string,
): Promise<ResearchProjectControls> {
  const entries = await Promise.all(
    Object.entries(researchProjectControlPaths).map(
      async ([name, relativePath]) => {
        const contents = await readOptionalControl(
          join(projectRoot, relativePath),
          relativePath,
        );
        return contents === undefined ? undefined : [name, contents];
      },
    ),
  );
  return Object.fromEntries(
    entries.filter((entry) => entry !== undefined),
  ) as ResearchProjectControls;
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
      `Research control cannot be read: ${relativePath}.`,
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
