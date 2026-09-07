import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type ResearchProjectControls,
  researchProjectControlPaths,
} from "../conformance/research-project-control-paths.js";
import { isMeetingNotePath } from "../conformance/research-project-controls/meeting-paths.js";
import { researchProjectSharedControlPaths } from "../contract/research-project-structure.js";
import { OperationalError } from "../operational-error.js";

export async function readResearchProjectControls(
  projectRoot: string,
  inventoryPaths: readonly string[] = [],
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
  const controls = Object.fromEntries(
    entries.filter((entry) => entry !== undefined),
  ) as ResearchProjectControls;
  const meetingNotes = Object.fromEntries(
    await Promise.all(
      inventoryPaths
        .filter((path) => isMeetingNotePath(path))
        .sort()
        .map(async (path) => [
          path,
          await readOptionalControl(join(projectRoot, path), path),
        ]),
    ),
  );
  const sharedControls = Object.fromEntries(
    await Promise.all(
      researchProjectSharedControlPaths.map(async (path) => [
        path,
        await readOptionalControl(join(projectRoot, path), path),
      ]),
    ),
  );
  return {
    ...controls,
    meetingNotes: Object.fromEntries(
      Object.entries(meetingNotes).filter(([, body]) => body !== undefined),
    ) as Record<string, string>,
    sharedControls: Object.fromEntries(
      Object.entries(sharedControls).filter(([, body]) => body !== undefined),
    ) as Record<string, string>,
  };
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
