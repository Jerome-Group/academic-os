import {
  defaultBookKey,
  shelfBooksSolutionsLast,
  UNPARSEABLE_NAME_NOTE,
} from "./parse-shelf-filename.js";
import type {
  ShelfIndex,
  ShelfParkReason,
  ShelfReader,
  ShelfSweep,
  SweptShelfBook,
} from "./types.js";

// The sweep is the migration's read-only first pass: it derives what a filename proves and asks
// the Owner about everything else. It runs before the index exists, so a book the index already
// names is one an earlier run settled and is left out of the sheet entirely.
export async function planShelfSweep(input: {
  reader: ShelfReader;
  index: ShelfIndex;
}): Promise<ShelfSweep> {
  const indexed = Object.entries(input.index.books);
  const indexedFiles = new Set(indexed.map(([, { file }]) => file));
  const keysHeld = new Map(indexed.map(([key, { file }]) => [key, file]));
  const filesByChecksum = new Map(
    indexed.map(([, { sha256, file }]) => [sha256, file]),
  );

  const shelved = await input.reader.listBooks();
  const books: SweptShelfBook[] = [];
  for (const { file, book } of shelfBooksSolutionsLast(
    shelved.filter((candidate) => !indexedFiles.has(candidate)),
  )) {
    const sha256 = await input.reader.checksum(file);
    // Recorded before anything else can send this book away, so a copy of the same bytes further
    // down the shelf is a duplicate of it even when the name it arrived under is unreadable.
    const twin = filesByChecksum.get(sha256);
    if (twin === undefined) filesByChecksum.set(sha256, file);

    if (book === undefined) {
      books.push(
        settleable(file, sha256, "unparseable-name", UNPARSEABLE_NAME_NOTE),
      );
      continue;
    }
    if (twin !== undefined) {
      books.push(
        settleable(
          file,
          sha256,
          "checksum-duplicate",
          `The same bytes are already on the shelf as ${twin}.`,
        ),
      );
      continue;
    }
    const key = defaultBookKey(book);
    const holder = keysHeld.get(key);
    if (holder !== undefined) {
      books.push(
        settleable(
          file,
          sha256,
          "key-collision",
          `The default Book key ${key} already names ${holder}.`,
        ),
      );
      continue;
    }
    keysHeld.set(key, file);
    books.push({ file, sha256, key });
  }

  return {
    counts: {
      books: shelved.length,
      indexed: shelved.length - books.length,
      settle: books.filter(({ settle }) => settle !== undefined).length,
    },
    books,
  };
}

function settleable(
  file: string,
  sha256: string,
  settle: ShelfParkReason,
  note: string,
): SweptShelfBook {
  return { file, sha256, settle, note };
}
