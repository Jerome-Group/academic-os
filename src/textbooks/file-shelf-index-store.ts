import { Document, isMap, isScalar, isSeq, parseDocument } from "yaml";

import { OperationalError } from "../operational-error.js";
import { readShelfFile } from "./shelf-file-observation.js";
import type {
  ShelfIndex,
  ShelfIndexAppend,
  ShelfIndexEntry,
  ShelfIndexReader,
} from "./types.js";

export const SHELF_INDEX_FILENAME = "00 Index.yaml";

const SHA256 = /^[0-9a-f]{64}$/u;

export function createFileShelfIndexReader(
  shelfRoot: string,
): ShelfIndexReader {
  return {
    read: async () => (await readShelfIndexDocument(shelfRoot)).index,
  };
}

// The index is edited in place rather than rewritten, so the Owner's comments, ordering and
// formatting survive a catch-up: what an append changes is the entries it adds and nothing else.
export function appendShelfEntries(
  document: Document,
  appends: readonly ShelfIndexAppend[],
): string {
  const index = readIndex(document);
  const keys = new Set(Object.keys(index.books));
  const files = new Set(Object.values(index.books).map((entry) => entry.file));
  const hashes = new Set(
    Object.values(index.books).map((entry) => entry.sha256),
  );
  for (const { key, entry } of appends) {
    readEntry(entry);
    if (keys.has(key) || files.has(entry.file) || hashes.has(entry.sha256))
      throw new Error(`Duplicate Shelf append: ${key}, ${entry.file}.`);
    keys.add(key);
    files.add(entry.file);
    hashes.add(entry.sha256);
  }
  const books = document.get("books", true);
  if (isScalar(books) && books.value === null) {
    const empty = document.createNode({});
    if (books.comment !== undefined) empty.comment = books.comment;
    if (books.commentBefore !== undefined)
      empty.commentBefore = books.commentBefore;
    document.set("books", empty);
  }
  for (const { key, entry } of appends) {
    if (index.books[key] !== undefined) {
      throw new OperationalError(
        "operational-failure",
        `The Shelf index already has an entry for ${key}; renaming or removing one is the Owner's.`,
      );
    }
    document.setIn(["books", key], entryNode(document, entry));
  }
  return document.toString({ flowCollectionPadding: false });
}

function entryNode(document: Document, entry: ShelfIndexEntry): unknown {
  const node = document.createNode({
    file: entry.file,
    title: entry.title,
    ...(entry.edition === undefined ? {} : { edition: entry.edition }),
    authors: entry.authors,
    ...(entry.division === undefined ? {} : { division: entry.division }),
    sha256: entry.sha256,
  });
  if (isMap(node)) {
    const authors = node.get("authors");
    if (isSeq(authors)) authors.flow = true;
  }
  return node;
}

export async function readShelfIndexDocument(shelfRoot: string) {
  const observed = await readShelfFile(shelfRoot, SHELF_INDEX_FILENAME);
  const contents =
    observed === null
      ? "books: {}\n"
      : new TextDecoder("utf-8", { fatal: true }).decode(observed.bytes);
  const document = parseDocument(contents);
  if (document.errors.length > 0) throw unreadableIndex();
  return {
    document,
    index: readIndex(document),
    observation: observed?.observation ?? null,
  };
}

function readIndex(document: Document): ShelfIndex {
  const value: unknown = document.toJS();
  if (value === null || value === undefined) return { books: {} };
  if (!isRecord(value)) throw unreadableIndex();
  const books = value.books ?? {};
  if (!isRecord(books)) throw unreadableIndex();
  return {
    books: Object.fromEntries(
      Object.entries(books).map(([key, entry]) => [key, readEntry(entry)]),
    ),
  };
}

function readEntry(value: unknown): ShelfIndexEntry {
  if (
    !isRecord(value) ||
    !isText(value.file) ||
    !isText(value.title) ||
    !Array.isArray(value.authors) ||
    value.authors.length === 0 ||
    !value.authors.every(isText) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256)
  ) {
    throw unreadableIndex();
  }
  return {
    file: value.file,
    title: value.title,
    ...(value.edition === undefined
      ? {}
      : { edition: readText(value.edition) }),
    authors: value.authors,
    ...(value.division === undefined
      ? {}
      : { division: readText(value.division) }),
    sha256: value.sha256,
  };
}

function readText(value: unknown): string {
  if (!isText(value)) throw unreadableIndex();
  return value;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function unreadableIndex(): OperationalError {
  return new OperationalError(
    "operational-failure",
    `The shelf's ${SHELF_INDEX_FILENAME} is not a readable Shelf index.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
