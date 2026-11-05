import { loadLocalConfig } from "../config/index.js";
import { OperationalError } from "../operational-error.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runConfigValidateCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const usage = "Usage: academic-os config validate --config <path> [--json]";
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "validate",
    valueFlags: ["--config"],
    booleanFlags: ["--json"],
    usage,
  });
  const path = values.get("--config");
  if (path === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const config = await loadLocalConfig(path);
  const kind =
    "activeSemester" in config
      ? "cohort"
      : "semester" in config
        ? "local"
        : "service";
  const formatVersion = config.schemaVersion ?? "unversioned";
  const report = {
    schemaVersion: 1,
    outcome: "valid",
    kind,
    formatVersion,
    validation: "schema",
  };
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `Configuration ${kind} ${formatVersion} matches its schema.\n`,
  );
}
