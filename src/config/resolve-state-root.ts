import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { OperationalError } from "../mounted/index.js";
import { isContainedBy } from "../mounted/is-contained-by.js";

// Private state is what the Owner's coursework and this public repository must both never carry,
// so every command that writes any resolves its root through here rather than trusting the path.
export async function resolveStateRoot(config: {
  driveMount: unknown;
  stateRoot: unknown;
}): Promise<string> {
  if (
    typeof config.driveMount !== "string" ||
    typeof config.stateRoot !== "string" ||
    !isAbsolute(config.driveMount) ||
    !isAbsolute(config.stateRoot)
  ) {
    throw new OperationalError(
      "invalid-config",
      "driveMount and stateRoot must be absolute paths.",
    );
  }
  const [driveMount, stateRoot, repositoryRoot] = await Promise.all([
    realpath(config.driveMount),
    realpath(config.stateRoot),
    realpath(fileURLToPath(new URL("../../../", import.meta.url))),
  ]).catch(() => {
    throw new OperationalError(
      "invalid-config",
      "Configured Drive mount and private state root cannot be resolved.",
    );
  });
  if (
    isContainedBy(driveMount, stateRoot) ||
    isContainedBy(repositoryRoot, stateRoot)
  ) {
    throw new OperationalError(
      "unsafe-state-root",
      "Private state must be outside the Drive mount and tracked repository.",
    );
  }
  return stateRoot;
}
