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

// The one-time migration's three settleable problems. They are the catch-up's three parks with
// the duplicate taken first: a second copy of bytes the shelf already holds is a book the Owner
// removes rather than keys, so it never claims the key its twin should keep.
export type ShelfSettlement =
  | "nonconforming-name"
  | "key-collision"
  | "duplicate-bytes";

// One row of the review sheet as the sweep leaves it. `key` is the default the sweep derived and
// the Owner may override; a settleable book has none, because deriving one would be the sweep
// answering the question it is asking.
export interface SweptShelfBook {
  file: string;
  sha256: string;
  key?: string;
  settle?: ShelfSettlement;
  note?: string;
}

export interface ShelfSweep {
  counts: { books: number; indexed: number; settle: number };
  books: SweptShelfBook[];
}

// The review sheet once the Owner has settled it: the shelf as it stands, the filename each book
// should end up carrying, and the Book key the index will hold it under.
export interface ShelfReviewBook {
  file: string;
  sha256: string;
  rename?: string;
  key?: string;
}

export interface ShelfReview {
  books: ShelfReviewBook[];
}

export interface ShelfRename {
  from: string;
  to: string;
}

// Blockers rather than throws: one preview names everything the Owner has left to settle, so the
// review is one pass rather than one round trip per problem.
export interface ShelfMigrationPlan {
  counts: { books: number };
  renames: ShelfRename[];
  appends: ShelfIndexAppend[];
  blockers: string[];
}

// Renaming is the migration's only write to the shelf, and it refuses a target that already
// exists: the Owner's books are never overwritten by a plan built against an earlier listing.
export interface ShelfRenamer {
  rename(rename: ShelfRename): Promise<void>;
}

export type ShelfMigrationEvent =
  | { type: "started"; renames: ShelfRename[]; keys: string[] }
  | { type: "renamed"; from: string; to: string }
  | { type: "indexed"; keys: string[] }
  | { type: "failed"; evidence: string };

export interface ShelfMigrationJournal {
  record(event: ShelfMigrationEvent): Promise<void>;
}

export interface ShelfMigrationReport {
  schemaVersion: 1;
  command: "textbooks migrate";
  outcome: "migrated" | "previewed" | "requires-decision";
  index: "written" | "not-written";
  counts: {
    books: number;
    renames: number;
    appends: number;
    blockers: number;
  };
  renames: ShelfRename[];
  appends: Array<{ key: string; file: string }>;
  blockers: string[];
}
