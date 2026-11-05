import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { OperationalError } from "../mounted/index.js";
import type { ServiceConfig } from "./types.js";
import { isContainedBy } from "../mounted/is-contained-by.js";
// The shelf is a path into the Owner's coursework, so it is configured rather than known here,
// and configured relative to the Drive mount for the same reason every semester root is.
export async function resolveShelfRoot(
  config: Pick<ServiceConfig, "driveMount" | "textbooks">,
): Promise<string> {
  const shelfRoot = config.textbooks?.shelfRoot;
  if (
    shelfRoot === undefined ||
    shelfRoot.length === 0 ||
    isAbsolute(shelfRoot)
  ) {
    throw new OperationalError(
      "invalid-config",
      "textbooks.shelfRoot must name the Textbook shelf relative to the Drive mount.",
    );
  }
  const driveMount = await existingDirectory(config.driveMount, "drive-mount");
  const candidate = join(driveMount, shelfRoot);
  if (!isContainedBy(driveMount, candidate)) {
    throw new OperationalError(
      "out-of-root",
      `The configured Textbook shelf escapes the Drive mount: ${shelfRoot}.`,
    );
  }
  const resolved = await existingDirectory(candidate, "textbook-shelf");
  if (!isContainedBy(driveMount, resolved)) {
    throw new OperationalError(
      "out-of-root",
      "The resolved Textbook shelf escapes the Drive mount.",
    );
  }
  return resolved;
}

async function existingDirectory(path: string, role: string): Promise<string> {
  try {
    const resolved = await realpath(path);
    if (!(await lstat(resolved)).isDirectory()) {
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
