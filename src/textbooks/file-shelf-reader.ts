import { createHash } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { OperationalError } from "../operational-error.js";
import { SHELF_INDEX_FILENAME } from "./file-shelf-index-store.js";
import type { ShelfReader } from "./types.js";

const FINDER_ICON_FILENAME = "Icon\r";

export function createFileShelfReader(shelfRoot: string): ShelfReader {
  return {
    listBooks: async () => await listShelfRoot(shelfRoot),
    checksum: async (file) => await checksum(join(shelfRoot, file)),
  };
}

// Only what sits directly on the shelf is a book of the shelf's, which is what keeps `Archive/`
// and its retired books invisible to the catch-up. Dot-files and the `Icon\r` a custom folder
// icon leaves behind are the mount's own artifacts rather than anything the Owner put there —
// and Finder writes that one back whenever the icon is set, so parking it would never end.
// The index is not a book either.
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
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        entry.name !== FINDER_ICON_FILENAME &&
        entry.name !== SHELF_INDEX_FILENAME,
    )
    .map(({ name }) => name)
    .sort();
}

async function checksum(path: string): Promise<string> {
  const digest = createHash("sha256");
  try {
    await pipeline(createReadStream(path), digest);
  } catch {
    throw new OperationalError(
      "operational-failure",
      `A book on the shelf cannot be read: ${path}.`,
    );
  }
  return digest.digest("hex");
}
