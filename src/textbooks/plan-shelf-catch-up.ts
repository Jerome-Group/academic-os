import {
  defaultBookKey,
  shelfBooksSolutionsLast,
  UNPARSEABLE_NAME_NOTE,
} from "./parse-shelf-filename.js";
import { shelfIndexEntry } from "./shelf-index-entry.js";
import type {
  ParkedShelfBook,
  ShelfCatchUpPlan,
  ShelfIndex,
  ShelfIndexAppend,
  ShelfReader,
} from "./types.js";

// The catch-up diffs the shelf against the index by filename first and checksum second, and every
// judgement it would otherwise have to make is a park instead: a name the codified naming does not
// accept, a default key already taken, and bytes already indexed under another name are the
// Owner's three decisions, not the tool's.
export async function planShelfCatchUp(input: {
  reader: ShelfReader;
  index: ShelfIndex;
}): Promise<ShelfCatchUpPlan> {
  const indexedEntries = Object.entries(input.index.books);
  const indexedFiles = new Set(indexedEntries.map(([, { file }]) => file));
  const keysHeld = new Map(
    indexedEntries.map(([key, { file }]) => [key, file]),
  );
  const filesByChecksum = new Map(
    indexedEntries.map(([key, { sha256, file }]) => [sha256, { key, file }]),
  );

  const books = await input.reader.listBooks();
  const appends: ShelfIndexAppend[] = [];
  const parked: ParkedShelfBook[] = [];
  for (const { file, book } of shelfBooksSolutionsLast(
    books.filter((shelved) => !indexedFiles.has(shelved)),
  )) {
    if (book === undefined) {
      parked.push(park(file, "unparseable-name", UNPARSEABLE_NAME_NOTE));
      continue;
    }
    const key = defaultBookKey(book);
    const keyHolder = keysHeld.get(key);
    if (keyHolder !== undefined) {
      parked.push(
        park(
          file,
          "key-collision",
          `The default Book key ${key} already names ${keyHolder}.`,
        ),
      );
      continue;
    }
    const sha256 = await input.reader.checksum(file);
    const duplicate = filesByChecksum.get(sha256);
    if (duplicate !== undefined) {
      parked.push(
        park(
          file,
          "checksum-duplicate",
          `The same bytes are already indexed as ${duplicate.key}: ${duplicate.file}.`,
        ),
      );
      continue;
    }
    appends.push({ key, entry: shelfIndexEntry({ file, book, sha256 }) });
    keysHeld.set(key, file);
    filesByChecksum.set(sha256, { key, file });
  }

  return {
    counts: {
      books: books.length,
      indexed: books.length - appends.length - parked.length,
    },
    appends,
    parked,
  };
}

function park(
  file: string,
  reason: ParkedShelfBook["reason"],
  note: string,
): ParkedShelfBook {
  return { file, reason, note };
}
