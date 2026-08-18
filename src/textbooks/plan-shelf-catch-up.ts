import { defaultBookKey, parseShelfFilename } from "./parse-shelf-filename.js";
import type {
  ParkedShelfBook,
  ParsedShelfBook,
  ShelfCatchUpPlan,
  ShelfIndex,
  ShelfIndexAppend,
  ShelfIndexEntry,
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
  for (const file of books.filter((book) => !indexedFiles.has(book))) {
    const book = parseShelfFilename(file);
    if (book === undefined) {
      parked.push(park(file, "unparseable-name", unparseableNote));
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
    const entry = shelfIndexEntry(file, book, sha256);
    appends.push({ key, entry });
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

const unparseableNote =
  "The filename does not follow <Title> <N>e <Author surnames, comma-separated>.pdf.";

function park(
  file: string,
  reason: ParkedShelfBook["reason"],
  note: string,
): ParkedShelfBook {
  return { file, reason, note };
}

function shelfIndexEntry(
  file: string,
  book: ParsedShelfBook,
  sha256: string,
): ShelfIndexEntry {
  return {
    file,
    // A solutions manual and the book it answers share a title, so the qualifier the filename
    // carries stays part of the title the index records.
    title: book.solutions ? `${book.title} Solutions` : book.title,
    ...(book.edition === undefined ? {} : { edition: book.edition }),
    authors: [...book.authors],
    sha256,
  };
}
