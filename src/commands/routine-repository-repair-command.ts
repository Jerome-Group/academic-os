import { fileURLToPath } from "node:url";

import {
  loadLocalConfig,
  resolveRoutineConfig,
  resolveStateRoot,
} from "../config/index.js";
import { runRepositoryRepair } from "../routine/repository-repair.js";
import { OperationalError } from "../mounted/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runRoutineRepositoryRepairCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "repository-repair",
    valueFlags: ["--config"],
    booleanFlags: ["--json", "--check-only"],
    usage:
      "Usage: academic-os routine repository-repair --config <path> [--check-only] [--json]",
  });
  const configPath = values.get("--config");
  if (configPath === undefined)
    throw new OperationalError("invalid-arguments", "--config is required.");
  const config = await loadLocalConfig(configPath);
  if (!("activeSemester" in config))
    throw new OperationalError(
      "invalid-config",
      "Repository repair requires the cohort configuration.",
    );
  const routine = resolveRoutineConfig(config);
  const report = await runRepositoryRepair({
    repositoryRoot: fileURLToPath(new URL("../../../", import.meta.url)),
    privateStateRoot: await resolveStateRoot(config),
    codexPath: routine.codexPath,
    ghPath: routine.ghPath,
    checkOnly: flags.has("--check-only"),
  });
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `Repository repair: ${report.outcome}${report.code ? `; ${report.code}` : ""}\n`,
  );
  process.exitCode =
    report.outcome === "healthy" || report.outcome === "merged" ? 0 : 1;
}
