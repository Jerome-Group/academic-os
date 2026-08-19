import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  loadLocalConfig,
  resolveShelfRoot,
  resolveStateRoot,
} from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  createFileShelfIndexStore,
  createFileShelfReader,
  planShelfSweep,
  renderShelfReviewSheet,
  type ShelfSweep,
  shelfReviewSheetPath,
} from "../textbooks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { quantity } from "./quantity.js";

const usage = "Usage: academic-os textbooks sweep --config <path> [--json]";

export async function runTextbooksSweepCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const config = await loadLocalConfig(configPath(arguments_));
  const [shelfRoot, stateRoot] = await Promise.all([
    resolveShelfRoot(config),
    resolveStateRoot(config),
  ]);
  const sweep = await planShelfSweep({
    reader: createFileShelfReader(shelfRoot),
    index: await createFileShelfIndexStore(shelfRoot).read(),
  });
  const sheet = shelfReviewSheetPath(stateRoot);
  await writeSheet(sheet, renderShelfReviewSheet({ sweep, shelf: shelfRoot }));
  const result = { schemaVersion: 1 as const, ...sweep, sheet };
  process.stdout.write(
    json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${renderHuman(sweep, sheet)}\n`,
  );
}

function configPath(arguments_: string[]): string {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "sweep",
    valueFlags: ["--config"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return configPath;
}

// The sheet is the Owner's working copy the moment it exists, and a second sweep would silently
// discard every key they had settled on it.
async function writeSheet(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new OperationalError(
      "operational-failure",
      `A review sheet is already waiting at ${path}; settle or delete it before sweeping again.`,
    );
  }
}

function renderHuman(sweep: ShelfSweep, sheet: string): string {
  const { counts } = sweep;
  return [
    `Textbook shelf sweep: ${quantity(counts.books, "book")} on the shelf; ${counts.indexed} already indexed, ${sweep.books.length} to migrate, ${counts.settle} to settle`,
    `Review sheet: ${sheet}`,
    ...sweep.books
      .filter(({ settle }) => settle !== undefined)
      .map((book) => `Settle ${book.file}: ${book.settle}; ${book.note}`),
  ].join("\n");
}
