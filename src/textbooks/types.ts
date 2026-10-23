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

export interface ShelfIndexReader {
  read(): Promise<ShelfIndex>;
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
  listing: string[];
  counts: { books: number; indexed: number };
  appends: ShelfIndexAppend[];
  parked: ParkedShelfBook[];
}

export interface ShelfCatchUpReport {
  schemaVersion: 1;
  command: "textbooks catch-up";
  outcome:
    | "caught-up"
    | "previewed"
    | "requires-decision"
    | "refused"
    | "partial";
  index: ShelfIndexOutcome;
  mutation?: ShelfMutationEvidence;
  counts: {
    books: number;
    indexed: number;
    appends: number;
    parked: number;
  };
  appends: Array<{ key: string; file: string }>;
  parked: ParkedShelfBook[];
}

// One row of the review sheet as the sweep leaves it. `key` is the default the sweep derived and
// the Owner may override; a settleable book has none, because deriving one would be the sweep
// answering the question it is asking. What it must settle is one of the catch-up's own three
// parks — the same three decisions, named the same way, taken here once instead of daily.
export interface SweptShelfBook {
  file: string;
  sha256: string;
  key?: string;
  settle?: ShelfParkReason;
  note?: string;
}

export interface ShelfSweep {
  counts: { books: number; indexed: number; settle: number };
  books: SweptShelfBook[];
}

// The review sheet once the Owner has settled it: the shelf as it stands, the filename each book
// should end up carrying, and the Book key the index will hold it under. `division` is asked of
// nobody — no filename carries it and reading 59 books is not one review pass (ADR-0009) — but the
// sheet is the one place the Owner is already looking, so a word they know goes in rather than
// waiting for the first cut to park.
export interface ShelfReviewBook {
  file: string;
  sha256: string;
  rename?: string;
  key?: string;
  division?: string;
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
  listing: string[];
  counts: { books: number };
  rows: ShelfApprovedRow[];
  renames: ShelfRename[];
  appends: ShelfIndexAppend[];
  blockers: string[];
}

export interface ShelfMigrationReport {
  schemaVersion: 1;
  command: "textbooks migrate";
  outcome:
    | "migrated"
    | "previewed"
    | "requires-decision"
    | "refused"
    | "partial";
  index: ShelfIndexOutcome;
  mutation?: ShelfMutationEvidence;
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

export interface ShelfApprovedRow {
  kind: "append" | "indexed";
  source: string;
  key: string;
  entry: ShelfIndexEntry;
}

export type ShelfIndexOutcome =
  | "written"
  | "not-written"
  | "published-unconfirmed"
  | "unknown";

export interface ShelfMutationEvidence {
  runId?: string;
  journal: string;
  captures: string[];
  renamed: ShelfRename[];
  reasons: string[];
  recovery?: ShelfRunObservation;
}

export interface ShelfRunObservation {
  schemaVersion: 1;
  command: "textbooks reconcile";
  runId: string;
  journal: string;
  state: "applied" | "unapplied" | "partial";
  index: ShelfIndexOutcome;
  paths: string[];
  evidence: string[];
}

export interface FileShelf {
  migrate(input: {
    review: ShelfReview;
    mode: "preview" | "apply";
  }): Promise<ShelfMigrationReport>;
  catchUp(input: { mode: "preview" | "apply" }): Promise<ShelfCatchUpReport>;
  reconcile(input: { runId: string }): Promise<ShelfRunObservation>;
}
