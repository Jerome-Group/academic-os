import { isAbsolute } from "node:path";

import { OperationalError } from "../mounted/index.js";
import type { TaskPlanningConfig, TasksConfig } from "./types.js";

export function resolveTasksConfig(config: { tasks?: unknown }): TasksConfig {
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
  return {
    credentials: { scheduledRead, interactiveWrite },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveTaskPlanningConfig(config: {
  tasks?: unknown;
}): TaskPlanningConfig | undefined {
  if (!isObject(config.tasks) || config.tasks.planning === undefined)
    return undefined;
  return parsePlanning(config.tasks.planning);
}

function parsePlanning(value: unknown): TaskPlanningConfig {
  const keys = [
    "releaseRoot",
    "manifestSha256",
    "sourceCommit",
    "privateRoot",
    "environment",
    "accountId",
    "sourceIdentity",
  ];
  if (
    !isObject(value) ||
    Object.keys(value).some(
      (key) => ![...keys, "catalogSourcePath"].includes(key),
    ) ||
    keys.some(
      (key) =>
        typeof value[key] !== "string" ||
        value[key].trim() === "" ||
        value[key].length > 4096,
    ) ||
    typeof value.releaseRoot !== "string" ||
    !isAbsolute(value.releaseRoot) ||
    typeof value.privateRoot !== "string" ||
    !isAbsolute(value.privateRoot) ||
    typeof value.manifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.manifestSha256) ||
    (value.catalogSourcePath !== undefined &&
      (typeof value.catalogSourcePath !== "string" ||
        !isAbsolute(value.catalogSourcePath))) ||
    typeof value.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.sourceCommit)
  )
    throw new OperationalError(
      "invalid-config",
      "Tasks planning requires exact private source identity and pinned producer configuration.",
    );
  const {
    releaseRoot,
    privateRoot,
    manifestSha256,
    sourceCommit,
    environment,
    accountId,
    sourceIdentity,
    catalogSourcePath,
  } = value;
  if (
    typeof releaseRoot !== "string" ||
    typeof privateRoot !== "string" ||
    typeof manifestSha256 !== "string" ||
    typeof sourceCommit !== "string" ||
    typeof environment !== "string" ||
    typeof accountId !== "string" ||
    typeof sourceIdentity !== "string"
  )
    throw new OperationalError(
      "invalid-config",
      "Invalid planning configuration.",
    );
  return {
    releaseRoot,
    privateRoot,
    manifestSha256,
    sourceCommit,
    environment,
    accountId,
    sourceIdentity,
    ...(typeof catalogSourcePath === "string" ? { catalogSourcePath } : {}),
  };
}
