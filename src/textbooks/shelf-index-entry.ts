import type { ParsedShelfBook, ShelfIndexEntry } from "./types.js";

// Every book-level fact the index holds except the Division word, which no filename carries. Both
// passes that write an entry — the daily catch-up and the one-time migration — build it here, so
// what a filename proves cannot come out differently depending on which one read it.
export function shelfIndexEntry(input: {
  file: string;
  book: ParsedShelfBook;
  sha256: string;
}): ShelfIndexEntry {
  return {
    file: input.file,
    title: input.book.title,
    ...(input.book.edition === undefined
      ? {}
      : { edition: input.book.edition }),
    authors: [...input.book.authors],
    sha256: input.sha256,
  };
}
