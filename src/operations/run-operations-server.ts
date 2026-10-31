import { fileURLToPath } from "node:url";

import { applyConfiguredTaskPlan } from "../tasks/configured-task-executor.js";
import { createMcpDispatcher } from "./dispatch-mcp-message.js";
import {
  OPERATIONS_PORT,
  type OperationsServerHandle,
  startOperationsServer,
} from "./serve-operations.js";
import { resolveTailnetAddresses } from "./tailnet-address.js";
import { guardedTaskTools } from "./task-plan-tools.js";
import { configuredTaskTools } from "./configured-task-tools.js";
import { createConfiguredCompletionPlanning } from "./configured-completion-planning.js";
import { createModuleCompletionTools } from "./module-completion-tools.js";
import { loadCohortTasksConfig } from "../commands/load-cohort-tasks-config.js";
import type { McpServerInfo, OperationTool } from "./types.js";

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
  const tools = await createConfiguredOperationsTools(input.configPath);
  return await startOperationsServer({
    hosts: resolveTailnetAddresses(),
    port: OPERATIONS_PORT,
    dispatch: createMcpDispatcher({
      tools,
      serverInfo: OPERATIONS_SERVER_INFO,
    }),
  });
}

export async function createConfiguredOperationsTools(
  configPath: string,
): Promise<OperationTool[]> {
  const catalog = await configuredTaskTools(configPath);
  const guarded = guardedTaskTools(
    catalog.map((tool) => ({
      ...tool,
      call: async (values) => {
        const current = await configuredTaskTools(configPath);
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
        await applyConfiguredTaskPlan({ configPath, plan }),
    },
  );
  const readRegister = guarded.find(
    (tool) => tool.name === "tasks_read_register",
  );
  if (readRegister === undefined)
    throw new Error("Official module register tool unavailable.");
  const { config } = await loadCohortTasksConfig(configPath);
  const completion = createConfiguredCompletionPlanning(config, readRegister);
  return [...guarded, ...createModuleCompletionTools(completion?.port)];
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
