import { loadLocalConfig, resolveStateRoot } from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import { readRepositoryRepairStatus } from "../routine/repository-repair.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runRoutineRepositoryStatusCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "repository-status",
    valueFlags: ["--config"],
    booleanFlags: ["--json"],
    usage:
      "Usage: academic-os routine repository-status --config <path> [--json]",
  });
  const configPath = values.get("--config");
  if (configPath === undefined)
    throw new OperationalError("invalid-arguments", "--config is required.");
  const config = await loadLocalConfig(configPath);
  const report = await readRepositoryRepairStatus(
    await resolveStateRoot(config),
  );
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `Repository status: ${report.outcome}${report.stage ? `; ${report.stage}` : ""}\n`,
  );
  process.exitCode =
    report.outcome === "unobserved"
      ? 2
      : report.outcome === "observed" &&
          (report.report?.outcome === "healthy" ||
            report.report?.outcome === "merged")
        ? 0
        : 1;
}
