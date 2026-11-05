import { loadCohortTasksConfig } from "./load-cohort-tasks-config.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { activeTaskRegisterTargets } from "../tasks/configured-task-targets.js";
import { OperationalError } from "../operational-error.js";

export async function runTasksStatusCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const usage = "Usage: academic-os tasks status --config <path> [--json]";
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "status",
    valueFlags: ["--config"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const { config } = await loadCohortTasksConfig(configPath);
  const targets = [];
  for (const target of activeTaskRegisterTargets(config)) {
    try {
      const receipt = await target.receiptStore?.read();
      targets.push({
        target: target.identity,
        outcome: receipt === undefined ? "unobserved" : "observed",
        receipt: receipt ?? null,
      });
    } catch {
      targets.push({
        target: target.identity,
        outcome: "failed",
        receipt: null,
      });
    }
  }
  const outcome = targets.some((target) => target.outcome === "failed")
    ? "failed"
    : "read";
  const report = {
    schemaVersion: 1,
    command: "tasks status",
    outcome,
    targets,
  };
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `Task refresh status: ${outcome}\n`,
  );
  if (outcome === "failed") process.exitCode = 2;
}
