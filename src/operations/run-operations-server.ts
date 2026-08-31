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
import type { McpServerInfo } from "./types.js";

export const OPERATIONS_SERVER_INFO: McpServerInfo = {
  name: "academic-os",
  title: "academic-os Operations server",
  version: "1.0.0",
};

// The mini's half of the boundary: the credentials, the module configuration and the machinery
// stay here, and every other machine gets the operations over the tailnet. A machine that is not
// on the tailnet cannot start the server at all — there is no address to bind that would serve
// anyone else.
export async function runOperationsServer(input: {
  configPath: string;
}): Promise<OperationsServerHandle> {
  const { config, tasks } = await loadCohortTasksConfig(input.configPath);
  const tools = createTaskTools({
    target: (module) => configuredTaskTarget(config, module),
    ...(config.research === undefined
      ? {}
      : {
          researchProjectTarget: (key: string) =>
            configuredResearchProjectTaskTarget(config, key, {
              requireActive: true,
            }),
        }),
    writer: createGoogleTaskOperationWriter(tasks.credentials.interactiveWrite),
    reader: createGoogleTaskRefreshReader(tasks.credentials.scheduledRead),
  });
  return await startOperationsServer({
    hosts: resolveTailnetAddresses(),
    port: OPERATIONS_PORT,
    dispatch: createMcpDispatcher({
      tools,
      serverInfo: OPERATIONS_SERVER_INFO,
    }),
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
