import { readFile } from "node:fs/promises";

import {
  loadLocalConfig,
  resolveShelfRoot,
  resolveStateRoot,
} from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  openFileShelf,
  readShelfReviewSheet,
  type ShelfMigrationReport,
  shelfReviewSheetPath,
} from "../textbooks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { quantity } from "./quantity.js";

const usage =
  "Usage: academic-os textbooks migrate --config <path> [--apply] [--json]";

export async function runTextbooksMigrateCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseMigrateArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  const [shelfRoot, stateRoot] = await Promise.all([
    resolveShelfRoot(config),
    resolveStateRoot(config),
  ]);
  const review = readShelfReviewSheet({
    contents: await readSheet(shelfReviewSheetPath(stateRoot)),
    shelfRoot,
  });
  const shelf = await openFileShelf({ shelfRoot, stateRoot });
  const report = await shelf.migrate({
    review,
    mode: parsed.apply ? "apply" : "preview",
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  if (report.outcome === "requires-decision") process.exitCode = 3;
  else if (["refused", "partial"].includes(report.outcome))
    process.exitCode = 2;
}

function parseMigrateArguments(arguments_: string[]): {
  configPath: string;
  apply: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "migrate",
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

async function readSheet(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new OperationalError(
      "missing-target",
      `No settled review sheet at ${path}; run textbooks sweep first.`,
    );
  }
}

function renderHuman(report: ShelfMigrationReport): string {
  const { counts } = report;
  return [
    `Textbook shelf migration: ${report.outcome}`,
    `${quantity(counts.books, "book")} in the review sheet; ${counts.renames} to rename, ${counts.appends} to index`,
    `Index: ${report.index}`,
    ...report.renames.map(({ from, to }) => `Rename ${from} -> ${to}`),
    ...report.appends.map(({ key, file }) => `Index ${key}: ${file}`),
    ...report.blockers.map((blocker) => `Blocked: ${blocker}`),
    ...(report.mutation?.reasons.map((reason) => `Evidence: ${reason}`) ?? []),
    ...(report.mutation?.captures.map(
      (path) => `Retained index capture/proposal: ${path}`,
    ) ?? []),
    ...(report.mutation?.recovery === undefined
      ? []
      : [`Recovery: ${JSON.stringify(report.mutation.recovery)}`]),
  ].join("\n");
}
