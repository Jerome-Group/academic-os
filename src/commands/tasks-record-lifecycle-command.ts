import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadLocalConfig, resolveStateRoot } from "../config/index.js";
import { OperationalError } from "../operational-error.js";
import { createFileTaskLifecycleStore } from "../tasks/file-task-lifecycle-store.js";
import type { TaskLifecycleEntry } from "../tasks/task-lifecycle.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runTasksRecordLifecycleCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const usage =
    "Usage: academic-os tasks record-lifecycle --config <path> --decision <private-json-path> [--json]";
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "record-lifecycle",
    valueFlags: ["--config", "--decision"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config"),
    decisionPath = values.get("--decision");
  if (configPath === undefined || decisionPath === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const config = await loadLocalConfig(configPath);
  const stateRoot = await resolveStateRoot(config);
  let decision: TaskLifecycleEntry;
  try {
    decision = JSON.parse(
      await readFile(decisionPath, "utf8"),
    ) as TaskLifecycleEntry;
  } catch {
    throw new OperationalError(
      "invalid-arguments",
      "The lifecycle decision must be a readable JSON document.",
    );
  }
  if (!["owner-dismissed", "completed"].includes(decision?.disposition))
    throw new OperationalError(
      "invalid-arguments",
      "An explicit terminal owner decision is required.",
    );
  const store = createFileTaskLifecycleStore({
    stateRoot,
    excludedRoots: [
      config.driveMount,
      fileURLToPath(new URL("../../../", import.meta.url)),
    ],
  });
  const state = await store.withMutation(
    async (session) => await session.record(decision),
  );
  const report = {
    schemaVersion: 1,
    command: "tasks record-lifecycle",
    outcome: "recorded",
    revision: state.revision,
  };
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : "Recorded owner lifecycle decision.\n",
  );
}
