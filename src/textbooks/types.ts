export interface ParsedShelfBook {
  title: string;
  edition?: string;
  authors: [string, ...string[]];
  solutions: boolean;
}

// The Shelf index owns every book-level fact, keyed by the immutable Book key. `division` — the
// book's own word for how it divides itself — is the one fact no filename carries, so an entry the
// catch-up appends has none until the Owner reads it off the book and records it.
export interface ShelfIndexEntry {
  file: string;
  title: string;
  edition?: string;
  authors: string[];
  division?: string;
  sha256: string;
}

export interface ShelfIndex {
  books: Record<string, ShelfIndexEntry>;
}

export interface ShelfIndexAppend {
  key: string;
  entry: ShelfIndexEntry;
}

// Reading the shelf is two operations because the second is expensive over a Drive mount: a
// catch-up lists every book but takes the bytes of only those the index does not already name.
export interface ShelfReader {
  listBooks(): Promise<string[]>;
  checksum(file: string): Promise<string>;
}

// Appending is the only write. The store has no operation that renames or removes an entry,
// because neither is the tool's to make.
export interface ShelfIndexStore {
  read(): Promise<ShelfIndex>;
  append(appends: readonly ShelfIndexAppend[]): Promise<void>;
}

export type ShelfParkReason =
  | "unparseable-name"
  | "key-collision"
  | "checksum-duplicate";

export interface ParkedShelfBook {
  file: string;
  reason: ShelfParkReason;
  note: string;
}

export interface ShelfCatchUpPlan {
  counts: { books: number; indexed: number };
  appends: ShelfIndexAppend[];
  parked: ParkedShelfBook[];
}

export interface ShelfCatchUpReport {
  schemaVersion: 1;
  command: "textbooks catch-up";
  outcome: "caught-up" | "previewed" | "requires-decision";
  index: "written" | "not-written";
  counts: {
    books: number;
    indexed: number;
    appends: number;
    parked: number;
  };
  appends: Array<{ key: string; file: string }>;
  parked: ParkedShelfBook[];
}
