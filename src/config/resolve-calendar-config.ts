import { isAbsolute } from "node:path";

import { OperationalError } from "../mounted/index.js";
import { resolveStateRoot } from "./resolve-state-root.js";
import type { ResolvedCalendarConfig } from "./types.js";

export async function resolveCalendarConfig(config: {
  driveMount: unknown;
  stateRoot: unknown;
  calendar?: unknown;
}): Promise<ResolvedCalendarConfig> {
  const stateRoot = await resolveStateRoot(config);
  if (!isObject(config.calendar) || !isObject(config.calendar.credentials)) {
    throw new OperationalError(
      "invalid-config",
      "Calendar configuration and credentials are required.",
    );
  }
  const horizon = new Date(String(config.calendar.managementHorizon ?? ""));
  const scheduledRead = config.calendar.credentials.scheduledRead;
  const interactiveWrite = config.calendar.credentials.interactiveWrite;
  if (Number.isNaN(horizon.valueOf())) {
    throw new OperationalError(
      "invalid-config",
      "calendar.managementHorizon must be an ISO-8601 instant.",
    );
  }
  if (
    typeof scheduledRead !== "string" ||
    typeof interactiveWrite !== "string" ||
    !isAbsolute(scheduledRead) ||
    !isAbsolute(interactiveWrite) ||
    scheduledRead === interactiveWrite
  ) {
    throw new OperationalError(
      "invalid-config",
      "Calendar scheduled-read and interactive-write credential paths must be distinct absolute paths.",
    );
  }
  return {
    stateRoot,
    managementHorizon: horizon.toISOString(),
    credentials: { scheduledRead, interactiveWrite },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
