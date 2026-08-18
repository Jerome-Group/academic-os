import { isAbsolute } from "node:path";

import { OperationalError } from "../mounted/index.js";
import type { ResolvedTasksConfig } from "./types.js";

export function resolveTasksConfig(config: {
  tasks?: unknown;
}): ResolvedTasksConfig {
  const tasks = config.tasks;
  if (!isObject(tasks) || !isObject(tasks.credentials)) {
    throw new OperationalError(
      "invalid-config",
      "Tasks configuration and credentials are required.",
    );
  }
  const scheduledRead = tasks.credentials.scheduledRead;
  const interactiveWrite = tasks.credentials.interactiveWrite;
  if (
    typeof scheduledRead !== "string" ||
    typeof interactiveWrite !== "string" ||
    !isAbsolute(scheduledRead) ||
    !isAbsolute(interactiveWrite) ||
    scheduledRead === interactiveWrite
  ) {
    throw new OperationalError(
      "invalid-config",
      "Tasks scheduled-read and interactive-write credential paths must be distinct absolute paths.",
    );
  }
  return { credentials: { scheduledRead, interactiveWrite } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
