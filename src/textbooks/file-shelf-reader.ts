import { isMountArtifact } from "../contract/mount-artifacts.js";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";

import { OperationalError } from "../operational-error.js";
import { SHELF_INDEX_FILENAME } from "./file-shelf-index-store.js";
import { observeShelfFile } from "./shelf-file-observation.js";
import type { ShelfReader } from "./types.js";

export function createFileShelfReader(shelfRoot: string): ShelfReader {
  return {
    listBooks: async () => await listShelfRoot(shelfRoot),
    checksum: async (file) => {
      const observed = await observeShelfFile(shelfRoot, file);
      if (observed === null) throw new Error(`Shelf book missing: ${file}.`);
      return observed.sha256;
    },
  };
}

// Only what sits directly on the shelf is a book of the shelf's, which is what keeps `Archive/`
// and its retired books invisible to the catch-up. The mount's own artifacts are not books, and
// the index is not one either.
async function listShelfRoot(shelfRoot: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(shelfRoot, { withFileTypes: true });
  } catch {
    throw new OperationalError(
      "missing-target",
      `The Textbook shelf cannot be listed: ${shelfRoot}.`,
    );
  }
  for (const entry of entries) {
    if (
      !entry.name.startsWith(".") &&
      entry.name !== SHELF_INDEX_FILENAME &&
      !entry.isFile() &&
      !entry.isDirectory()
    )
      throw new Error(`Nonordinary Shelf entry: ${entry.name}.`);
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !isMountArtifact({ name: entry.name, isFile: true, size: 0 }) &&
        entry.name !== SHELF_INDEX_FILENAME,
    )
    .map(({ name }) => name)
    .sort();
}
