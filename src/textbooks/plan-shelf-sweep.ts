import { defaultBookKey, parseShelfFilename } from "./parse-shelf-filename.js";
import type {
  ShelfIndex,
  ShelfReader,
  ShelfSettlement,
  ShelfSweep,
  SweptShelfBook,
} from "./types.js";

const NONCONFORMING_NOTE =
  "The filename does not follow <Title> <N>e <Author surnames, comma-separated>.pdf.";

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
  for (const file of solutionsLast(
    shelved.filter((candidate) => !indexedFiles.has(candidate)),
  )) {
    const sha256 = await input.reader.checksum(file);
    const parsed = parseShelfFilename(file);
    if (parsed === undefined) {
      books.push(
        settleable(file, sha256, "nonconforming-name", NONCONFORMING_NOTE),
      );
      continue;
    }
    const twin = filesByChecksum.get(sha256);
    if (twin !== undefined) {
      books.push(
        settleable(
          file,
          sha256,
          "duplicate-bytes",
          `The same bytes are already on the shelf as ${twin}.`,
        ),
      );
      continue;
    }
    const key = defaultBookKey(parsed);
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
    filesByChecksum.set(sha256, file);
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

// A solutions manual answers a book and the two share a surname, so the books are considered
// first and the plain key falls to the book rather than to the manual.
function solutionsLast(files: string[]): string[] {
  const solutions = (file: string): boolean =>
    parseShelfFilename(file)?.solutions === true;
  return [
    ...files.filter((file) => !solutions(file)),
    ...files.filter(solutions),
  ];
}

function settleable(
  file: string,
  sha256: string,
  settle: ShelfSettlement,
  note: string,
): SweptShelfBook {
  return { file, sha256, settle, note };
}
