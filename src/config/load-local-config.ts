import { readFile } from "node:fs/promises";
import { ConfigurationError } from "./configuration-error.js";
import { parseConfig } from "./parse-config.js";
import type { LoadedConfig } from "./types.js";

export async function loadLocalConfig(path: string): Promise<LoadedConfig> {
  let contents: Uint8Array;
  try {
    contents = await readFile(path);
  } catch {
    throw new ConfigurationError([
      {
        code: "unreadable-config",
        pointer: "",
        expected: "a readable configuration file",
        remediation: "Check the supplied configuration path and permissions.",
      },
    ]);
  }
  return parseConfig(contents);
}
