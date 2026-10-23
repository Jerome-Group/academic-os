import {
  loadLocalConfig,
  resolveShelfRoot,
  resolveStateRoot,
} from "../config/index.js";
import { OperationalError } from "../operational-error.js";
import { openFileShelf } from "../textbooks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runTextbooksReconcileCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const usage =
    "Usage: academic-os textbooks reconcile --config <path> --run <run-id> [--json]";
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "reconcile",
    valueFlags: ["--config", "--run"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  const runId = values.get("--run");
  if (configPath === undefined || runId === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const config = await loadLocalConfig(configPath);
  const [shelfRoot, stateRoot] = await Promise.all([
    resolveShelfRoot(config),
    resolveStateRoot(config),
  ]);
  const report = await (
    await openFileShelf({ shelfRoot, stateRoot })
  ).reconcile({ runId });
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : [
          `Textbook shelf reconciliation: ${report.state}`,
          `Run: ${report.runId}`,
          `Index: ${report.index}`,
          `Journal: ${report.journal}`,
          ...report.paths,
          ...report.evidence,
          "",
        ].join("\n"),
  );
  if (report.state === "partial") process.exitCode = 2;
}
