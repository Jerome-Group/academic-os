import { loadLocalConfig, resolveTextbooksConfig } from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  createFileShelfIndexStore,
  createFileShelfReader,
  executeShelfCatchUp,
  planShelfCatchUp,
  type ParkedShelfBook,
  type ShelfCatchUpReport,
} from "../textbooks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { quantity } from "./quantity.js";

const usage =
  "Usage: academic-os textbooks catch-up --config <path> [--apply] [--json]";

export async function runTextbooksCatchUpCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseCatchUpArguments(arguments_);
  const { shelfRoot } = await resolveTextbooksConfig(
    await loadLocalConfig(parsed.configPath),
  );
  const store = createFileShelfIndexStore(shelfRoot);
  const plan = await planShelfCatchUp({
    reader: createFileShelfReader(shelfRoot),
    index: await store.read(),
  });
  const report = await executeShelfCatchUp({
    plan,
    store,
    mode: parsed.apply ? "apply" : "preview",
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  if (report.outcome === "requires-decision") process.exitCode = 1;
}

function parseCatchUpArguments(arguments_: string[]): {
  configPath: string;
  apply: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "catch-up",
    valueFlags: ["--config"],
    booleanFlags: ["--apply", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return { configPath, apply: flags.has("--apply") };
}

function renderHuman(report: ShelfCatchUpReport): string {
  const { counts } = report;
  return [
    `Textbook shelf catch-up: ${report.outcome}`,
    `${quantity(counts.books, "book")} on the shelf; ${counts.indexed} already indexed, ${counts.appends} to append, ${counts.parked} parked`,
    `Index: ${report.index}`,
    ...report.appends.map(({ key, file }) => `Append ${key}: ${file}`),
    ...report.parked.map(renderParked),
  ].join("\n");
}

function renderParked(parked: ParkedShelfBook): string {
  return `Park ${parked.file}: ${parked.reason}; ${parked.note}`;
}
