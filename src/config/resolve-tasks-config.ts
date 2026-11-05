import { OperationalError } from "../operational-error.js";
import type {
  ServiceConfig,
  TaskPlanningConfig,
  TasksConfig,
} from "./types.js";

export function resolveTasksConfig(
  config: Pick<ServiceConfig, "tasks">,
): TasksConfig {
  if (config.tasks === undefined) {
    throw new OperationalError(
      "invalid-config",
      "Tasks configuration and credentials are required.",
    );
  }
  const { scheduledRead, interactiveWrite } = config.tasks.credentials;
  if (scheduledRead === interactiveWrite) {
    throw new OperationalError(
      "invalid-config",
      "Tasks scheduled-read and interactive-write credential paths must be distinct absolute paths.",
    );
  }
  return { credentials: { scheduledRead, interactiveWrite } };
}

export function resolveTaskPlanningConfig(
  config: Pick<ServiceConfig, "tasks">,
): TaskPlanningConfig | undefined {
  return config.tasks?.planning;
}
