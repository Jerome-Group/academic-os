import {
  type AcademicConfig,
  loadLocalConfig,
  resolveTasksConfig,
  type TasksConfig,
} from "../config/index.js";
import { OperationalError } from "../mounted/index.js";

// Every Tasks command addresses modules by semester and module code, so all of them need the
// cohort configuration rather than the single-target shape the older commands still accept.
export async function loadCohortTasksConfig(
  configPath: string,
): Promise<{ config: AcademicConfig; tasks: TasksConfig }> {
  const config = await loadLocalConfig(configPath);
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Tasks commands require the cohort configuration.",
    );
  }
  return { config, tasks: resolveTasksConfig(config) };
}
