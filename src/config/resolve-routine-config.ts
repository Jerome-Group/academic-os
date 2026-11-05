import { OperationalError } from "../operational-error.js";
import type { RoutineConfig, ServiceConfig } from "./types.js";

export function resolveRoutineConfig(
  config: Pick<ServiceConfig, "routine">,
): RoutineConfig {
  if (config.routine === undefined) {
    throw new OperationalError(
      "invalid-config",
      "The morning routine requires a routine configuration.",
    );
  }
  return config.routine;
}
