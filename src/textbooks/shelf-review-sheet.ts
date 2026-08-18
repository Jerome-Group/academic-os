import { join } from "node:path";

import { Document, isMap, isSeq, parseDocument } from "yaml";

import { OperationalError } from "../operational-error.js";
import type {
  ShelfParkReason,
  ShelfReview,
  ShelfSweep,
  SweptShelfBook,
} from "./types.js";

export const SHELF_REVIEW_FILENAME = "shelf-review.yaml";

// The sheet names the Owner's own books, so it lives in private state beside the other artifacts
// no repository and no Drive folder may carry.
export function shelfReviewSheetPath(stateRoot: string): string {
  return join(stateRoot, "textbooks", SHELF_REVIEW_FILENAME);
}

const SHA256 = /^[0-9a-f]{64}$/u;

const PREAMBLE = `Textbook shelf migration — the one review pass.

Settle every book carrying a SETTLE comment, then run the migration to apply it:

  academic-os textbooks migrate --config <path>            # preview
  academic-os textbooks migrate --config <path> --apply    # renames, then the index

rename    the filename the book should end up carrying. Blank keeps the name it has.
key       the Book key the Shelf index will hold it under, and every chapter filename will
          cite. Blank is unsettled: the migration refuses to run until it is filled.
division  the book's own word for how it divides itself — Chapter, Lecture, Part. Nothing
          asks for it and blank is fine: no filename carries it, and the first cut from a
          book without one parks until you record it. Fill in the ones you already know.

A key is immutable once a chapter cites it, so this sheet is where a collision is
qualified once — Isaacs_FGT beside Isaacs_CT — and never again.`;

// The sheet is what the Owner edits, so the guidance travels in it rather than in a doc they
// would have to be holding: each settleable book carries the question above the line answering it.
export function renderShelfReviewSheet(input: {
  sweep: ShelfSweep;
  shelf: string;
}): string {
  const document = new Document({
    schemaVersion: 1,
    shelf: input.shelf,
    books: input.sweep.books.map((book) => ({
      file: book.file,
      sha256: book.sha256,
      rename: null,
      key: book.key ?? null,
      division: null,
    })),
  });
  document.commentBefore = commentLines(PREAMBLE);
  const books = document.get("books");
  if (isSeq(books)) {
    for (const [position, node] of books.items.entries()) {
      const book = input.sweep.books[position];
      if (isMap(node) && book !== undefined && book.settle !== undefined) {
        node.commentBefore = commentLines(
          settlementQuestion({ ...book, settle: book.settle }),
        );
      }
    }
  }
  return document.toString({ flowCollectionPadding: false, nullStr: "" });
}

export function readShelfReviewSheet(contents: string): ShelfReview {
  const document = parseDocument(contents);
  if (document.errors.length > 0) throw unreadableSheet();
  const value: unknown = document.toJS();
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.books)
  ) {
    throw unreadableSheet();
  }
  return { books: value.books.map(readReviewBook) };
}

function readReviewBook(value: unknown): ShelfReview["books"][number] {
  if (
    !isRecord(value) ||
    !isText(value.file) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    Object.keys(value).some(
      (field) =>
        !["file", "sha256", "rename", "key", "division"].includes(field),
    )
  ) {
    throw unreadableSheet();
  }
  return {
    file: value.file,
    sha256: value.sha256,
    ...(isBlank(value.rename) ? {} : { rename: readText(value.rename) }),
    ...(isBlank(value.key) ? {} : { key: readText(value.key) }),
    ...(isBlank(value.division) ? {} : { division: readText(value.division) }),
  };
}

const SETTLEMENTS: Record<ShelfParkReason, string> = {
  "unparseable-name":
    "SETTLE — set `rename` to a conforming filename, and `key` to the key it should carry.",
  "key-collision":
    "SETTLE — set `key` to a qualifier that tells this book from the one holding the default.",
  // Two files of the same bytes are one book, so there is no third resolution that indexes both:
  // the migration refuses a sheet that tries, and one of the two leaves the shelf.
  "checksum-duplicate":
    "SETTLE — archive or remove one of the two copies, then delete this sheet and sweep again.",
};

function settlementQuestion(
  book: SweptShelfBook & { settle: ShelfParkReason },
): string {
  return `${book.note ?? ""}\n${SETTLEMENTS[book.settle]}`;
}

function commentLines(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : ` ${line}`))
    .join("\n");
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function readText(value: unknown): string {
  if (!isText(value)) throw unreadableSheet();
  return value;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value !== "";
}

function unreadableSheet(): OperationalError {
  return new OperationalError(
    "operational-failure",
    `The ${SHELF_REVIEW_FILENAME} is not a readable shelf review sheet.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
