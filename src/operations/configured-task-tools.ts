import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { loadCohortTasksConfig } from "../commands/load-cohort-tasks-config.js";
import { resolveTarget } from "../mounted/index.js";
import {
  configuredResearchProjectTaskTarget,
  configuredTaskTarget,
  createGoogleTaskOperationWriter,
  createGoogleTaskRefreshReader,
} from "../tasks/index.js";
import { finalStudyTool } from "./final-study-tool.js";
import { createTaskTools } from "./task-tools.js";
import type { OperationTool } from "./types.js";

export async function configuredTaskTools(
  configPath: string,
): Promise<OperationTool[]> {
  const { config, tasks } = await loadCohortTasksConfig(configPath);
  const port = {
    target: (module: { semester: string; module: string }) =>
      configuredTaskTarget(config, module),
    researchProjectTarget: (key: string) =>
      configuredResearchProjectTaskTarget(config, key, { requireActive: true }),
    writer: createGoogleTaskOperationWriter(tasks.credentials.interactiveWrite),
    reader: createGoogleTaskRefreshReader(tasks.credentials.scheduledRead),
  };
  return [
    ...createTaskTools(port),
    finalStudyTool(
      port,
      async ({ semester, module }) =>
        (
          await resolveTarget(
            resolveConfiguredAuditTarget(config, semester, module),
          )
        ).moduleRoot,
    ),
  ];
}
