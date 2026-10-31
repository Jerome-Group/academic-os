import { loadCohortTasksConfig } from "../commands/load-cohort-tasks-config.js";
import {
  configuredResearchProjectTaskTarget,
  configuredTaskTarget,
  createGoogleTaskOperationWriter,
  createGoogleTaskRefreshReader,
} from "../tasks/index.js";
import { createTaskTools } from "./task-tools.js";
import type { OperationTool } from "./types.js";

export async function configuredTaskTools(
  configPath: string,
): Promise<OperationTool[]> {
  const { config, tasks } = await loadCohortTasksConfig(configPath);
  return createTaskTools({
    target: (module) => configuredTaskTarget(config, module),
    researchProjectTarget: (key) =>
      configuredResearchProjectTaskTarget(config, key, { requireActive: true }),
    writer: createGoogleTaskOperationWriter(tasks.credentials.interactiveWrite),
    reader: createGoogleTaskRefreshReader(tasks.credentials.scheduledRead),
  });
}
