import { fileURLToPath } from "node:url";

import { loadCohortTasksConfig } from "../commands/load-cohort-tasks-config.js";
import {
  configuredResearchProjectTaskTarget,
  configuredTaskTarget,
  createGoogleTaskOperationWriter,
  createGoogleTaskRefreshReader,
} from "../tasks/index.js";
import { createMcpDispatcher } from "./dispatch-mcp-message.js";
import {
  OPERATIONS_PORT,
  startOperationsServer,
  type OperationsServerHandle,
} from "./serve-operations.js";
import { resolveTailnetAddresses } from "./tailnet-address.js";
import { createTaskTools } from "./task-tools.js";
import { guardedTaskTools } from "./task-plan-tools.js";
import { applyConfiguredTaskPlan } from "../tasks/configured-task-executor.js";
import type { OperationTool } from "./types.js";
import type { McpServerInfo } from "./types.js";

export const OPERATIONS_SERVER_INFO: McpServerInfo = {
  name: "academic-os",
  title: "academic-os Operations server",
  version: "2.1.0",
};

// The mini's half of the boundary: the credentials, the module configuration and the machinery
// stay here, and every other machine gets the operations over the tailnet. A machine that is not
// on the tailnet cannot start the server at all — there is no address to bind that would serve
// anyone else.
export async function runOperationsServer(input: {
  configPath: string;
}): Promise<OperationsServerHandle> {
  const catalog = await configuredTaskTools(input.configPath);
  const tools = guardedTaskTools(
    catalog.map((tool) => ({
      ...tool,
      call: async (values) => {
        const current = await configuredTaskTools(input.configPath);
        const selected = current.find(
          (candidate) => candidate.name === tool.name,
        );
        if (selected === undefined)
          throw new Error("Configured task tool is unavailable.");
        return await selected.call(values);
      },
    })),
    {
      apply: async (plan) =>
        await applyConfiguredTaskPlan({ configPath: input.configPath, plan }),
    },
  );
  return await startOperationsServer({
    hosts: resolveTailnetAddresses(),
    port: OPERATIONS_PORT,
    dispatch: createMcpDispatcher({
      tools,
      serverInfo: OPERATIONS_SERVER_INFO,
    }),
  });
}

async function configuredTaskTools(
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

async function runFromCommandLine(): Promise<void> {
  const [configPath] = process.argv.slice(2);
  if (configPath === undefined) {
    process.stderr.write("Usage: run-operations-server <config-path>\n");
    process.exitCode = 64;
    return;
  }
  try {
    const server = await runOperationsServer({ configPath });
    process.stdout.write(
      `Operations server listening on ${server.urls.join(", ")}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runFromCommandLine();
}
