import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { OperationalError } from "../operational-error.js";

const executeFile = promisify(execFile);

export async function ensureMaterialized(root: string): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  let placeholder = "";
  try {
    const result = await executeFile("/usr/bin/find", [
      "-x",
      root,
      "-flags",
      "+dataless",
      "-print",
      "-quit",
    ]);
    placeholder = result.stdout.trim();
  } catch {
    throw new OperationalError(
      "unsafe-inventory",
      `Dataless-placeholder checks failed for ${root}.`,
    );
  }

  if (placeholder !== "") {
    throw new OperationalError(
      "unresolved-placeholder",
      `Unresolved cloud placeholder blocks inventory: ${placeholder}.`,
    );
  }
}
