import { readFile } from "node:fs/promises";

import { OperationalError, type LocalConfig } from "../mounted/index.js";
import type { AcademicConfig } from "./types.js";

export async function loadLocalConfig(
  path: string,
): Promise<LocalConfig | AcademicConfig> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new OperationalError(
      "invalid-config",
      `Configuration cannot be read: ${path}.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new OperationalError(
      "invalid-config",
      `Configuration is not valid JSON: ${path}.`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OperationalError(
      "invalid-config",
      "Configuration must be a JSON object.",
    );
  }

  return value as LocalConfig | AcademicConfig;
}
