import { OperationalError } from "../operational-error.js";
import { publishConfiguredCompletionCatalog } from "../operations/publish-completion-catalog.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runTasksPublishCompletionCatalogCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const usage =
    "Usage: academic-os tasks publish-completion-catalog --config <path> [--json]";
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "publish-completion-catalog",
    valueFlags: ["--config"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const result = await publishConfiguredCompletionCatalog(configPath);
  process.stdout.write(
    json
      ? `${JSON.stringify(result.report, null, 2)}\n`
      : `Completion catalog: ${result.report.status}\n`,
  );
  if (result.failed) process.exitCode = 2;
}
