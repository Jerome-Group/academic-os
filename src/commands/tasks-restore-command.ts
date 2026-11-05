import { readFile } from "node:fs/promises";
import { OperationalError } from "../operational-error.js";
import { restoreConfiguredTask } from "../tasks/configured-task-restore.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runTasksRestoreCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const usage =
    "Usage: academic-os tasks restore --config <path> --plan <private-json-path> [--apply] [--json]";
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "restore",
    valueFlags: ["--config", "--plan"],
    booleanFlags: ["--json", "--apply"],
    usage,
  });
  const configPath = values.get("--config"),
    planPath = values.get("--plan");
  if (configPath === undefined || planPath === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const plan: unknown = JSON.parse(await readFile(planPath, "utf8"));
  const report = await restoreConfiguredTask({
    configPath,
    plan,
    apply: flags.has("--apply"),
  });
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `Task restore: ${report.outcome}\n`,
  );
  if (report.outcome !== "preview" && report.outcome !== "applied")
    process.exitCode = 2;
}
