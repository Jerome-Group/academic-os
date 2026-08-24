import { isAbsolute } from "node:path";

import { OperationalError } from "../mounted/index.js";
import type { RoutineConfig } from "./types.js";

// A LaunchAgent runs with a minimal PATH, so neither tool can be found by name at 06:00. Both are
// read from configuration rather than hardcoded, because both install per user.
export function resolveRoutineConfig(config: {
  routine?: unknown;
}): RoutineConfig {
  const routine = config.routine;
  if (
    typeof routine !== "object" ||
    routine === null ||
    Array.isArray(routine)
  ) {
    throw new OperationalError(
      "invalid-config",
      "The morning routine requires a routine configuration.",
    );
  }
  const { codexPath, ghPath } = routine as Record<string, unknown>;
  if (
    typeof codexPath !== "string" ||
    !isAbsolute(codexPath) ||
    typeof ghPath !== "string" ||
    !isAbsolute(ghPath)
  ) {
    throw new OperationalError(
      "invalid-config",
      "routine.codexPath and routine.ghPath must be absolute paths to the Codex and gh CLIs.",
    );
  }
  return { codexPath, ghPath };
}
