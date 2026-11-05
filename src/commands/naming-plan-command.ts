import { readFile } from "node:fs/promises";
import { planNamingJson } from "../naming/index.js";
import { OperationalError } from "../operational-error.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage = "Usage: academic-os naming plan --input <private-json> [--json]";

export async function runNamingPlanCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "plan",
    valueFlags: ["--input"],
    booleanFlags: ["--json"],
    usage,
  });
  const path = values.get("--input");
  if (path === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const report = planNamingJson(await readFile(path));
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${report.outcome}\n`,
  );
  process.exitCode = report.outcome === "resolved" ? 0 : 2;
}
