import { readFile } from "node:fs/promises";
import { OperationalError } from "../operational-error.js";
import { applyConfiguredTaskPlan } from "../tasks/configured-task-executor.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runTasksApplyPlanCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const usage =
    "Usage: academic-os tasks apply-plan --config <path> --plan <path> [--json]";
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "apply-plan",
    valueFlags: ["--config", "--plan"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  const planPath = values.get("--plan");
  if (configPath === undefined || planPath === undefined)
    throw new OperationalError("invalid-arguments", usage);
  let plan: unknown;
  try {
    plan = JSON.parse(await readFile(planPath, "utf8"));
  } catch {
    throw new OperationalError(
      "invalid-arguments",
      "The task plan must be a readable JSON document.",
    );
  }
  const report = await applyConfiguredTaskPlan({ configPath, plan });
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `Task plan: ${report.outcome}\n`,
  );
  if (report.outcome !== "applied") process.exitCode = 2;
}
