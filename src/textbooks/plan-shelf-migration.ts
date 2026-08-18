import { parseShelfFilename } from "./parse-shelf-filename.js";
import type {
  ShelfIndex,
  ShelfIndexAppend,
  ShelfMigrationPlan,
  ShelfReader,
  ShelfRename,
  ShelfReview,
  ShelfReviewBook,
} from "./types.js";

const KEY = /^\p{Lu}[\p{L}\p{N}_]*$/u;

// The settled sheet is an approval, so the plan's job is to prove it still describes the shelf the
// Owner reviewed. Every disagreement is a blocker rather than a throw: one preview names
// everything left to settle, which is what keeps the review to the single pass it was designed as.
export async function planShelfMigration(input: {
  reader: ShelfReader;
  index: ShelfIndex;
  review: ShelfReview;
}): Promise<ShelfMigrationPlan> {
  const { books } = input.review;
  const shelved = await input.reader.listBooks();
  const indexedFiles = new Set(
    Object.values(input.index.books).map(({ file }) => file),
  );
  const blockers = shelfDisagreements(shelved, indexedFiles, books);
  const reviewed = new Set(books.map(({ file }) => file));
  blockers.push(
    ...(await staleChecksums(
      input.reader,
      books.filter(({ file }) => shelved.includes(file)),
    )),
  );

  const renames: ShelfRename[] = [];
  const appends: ShelfIndexAppend[] = [];
  const finalNames = new Map<string, string>();
  const keys = new Map<string, string>();
  for (const book of books) {
    const to = book.rename ?? book.file;
    const occupant =
      finalNames.get(to) ??
      standingOccupant(to, book.file, {
        shelved,
        reviewed,
      });
    if (occupant !== undefined) {
      blockers.push(`Naming ${book.file} ${to} would land on ${occupant}.`);
      continue;
    }
    finalNames.set(to, book.file);
    const parsed = parseShelfFilename(to);
    if (parsed === undefined) {
      blockers.push(
        `${to} does not follow <Title> <N>e <Author surnames, comma-separated>.pdf.`,
      );
      continue;
    }
    if (book.key === undefined) {
      blockers.push(`${to} has no settled Book key.`);
      continue;
    }
    if (!KEY.test(book.key)) {
      blockers.push(
        `The Book key ${book.key} is not a capitalised, filename-safe token.`,
      );
      continue;
    }
    const holder = keys.get(book.key) ?? input.index.books[book.key]?.file;
    if (holder !== undefined) {
      blockers.push(`The Book key ${book.key} already names ${holder}.`);
      continue;
    }
    keys.set(book.key, to);
    if (to !== book.file) renames.push({ from: book.file, to });
    appends.push({
      key: book.key,
      entry: {
        file: to,
        title: parsed.title,
        ...(parsed.edition === undefined ? {} : { edition: parsed.edition }),
        authors: [...parsed.authors],
        sha256: book.sha256,
      },
    });
  }
  blockers.push(...chainedRenames(renames));
  return { counts: { books: books.length }, renames, appends, blockers };
}

// A rename whose target another rename is vacating only works in one order, and in a cycle in
// none. Ordering them is not worth carrying for a one-time pass: the Owner moves one book by hand
// and sweeps again, and every rename this plan does apply is independent of every other.
function chainedRenames(renames: ShelfRename[]): string[] {
  const sources = new Set(renames.map(({ from }) => from));
  return renames
    .filter(({ to }) => sources.has(to))
    .map(
      ({ from, to }) =>
        `Naming ${from} ${to} would land on a book another rename moves away; move one by hand and sweep again.`,
    );
}

// What still stands under a name once every approved rename has run: a book the review does not
// move, whether the index already names it or the sheet leaves its name alone.
function standingOccupant(
  to: string,
  from: string,
  shelf: { shelved: string[]; reviewed: ReadonlySet<string> },
): string | undefined {
  if (to === from || !shelf.shelved.includes(to)) return undefined;
  return shelf.reviewed.has(to) ? undefined : to;
}

// Paths are evidence rather than identity, so the sheet is held against a fresh listing before a
// single book moves: a shelf that has changed under the review is a re-sweep, not a rename.
function shelfDisagreements(
  shelved: string[],
  indexedFiles: ReadonlySet<string>,
  books: ShelfReviewBook[],
): string[] {
  const reviewed = new Set(books.map(({ file }) => file));
  const disagreements = [
    ...shelved
      .filter((file) => !reviewed.has(file) && !indexedFiles.has(file))
      .map((file) => `${file} is on the shelf and not in the review sheet.`),
    ...books
      .map(({ file }) => file)
      .filter((file) => !shelved.includes(file))
      .map((file) => `${file} is in the review sheet and not on the shelf.`),
  ];
  return disagreements.length > 0
    ? [
        ...disagreements,
        "The shelf has moved under the review sheet; sweep again.",
      ]
    : [];
}

async function staleChecksums(
  reader: ShelfReader,
  books: ShelfReviewBook[],
): Promise<string[]> {
  const stale: string[] = [];
  for (const book of books) {
    if ((await reader.checksum(book.file)) !== book.sha256) {
      stale.push(`${book.file} is not the copy the review sheet pinned.`);
    }
  }
  return stale;
}
