import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Document, isMap, isSeq, parseDocument } from "yaml";

import { OperationalError } from "../operational-error.js";
import type {
  ShelfIndex,
  ShelfIndexAppend,
  ShelfIndexEntry,
  ShelfIndexStore,
} from "./types.js";

export const SHELF_INDEX_FILENAME = "00 Index.yaml";

const SHA256 = /^[0-9a-f]{64}$/u;

export function createFileShelfIndexStore(shelfRoot: string): ShelfIndexStore {
  const indexPath = join(shelfRoot, SHELF_INDEX_FILENAME);
  return {
    read: async () => readIndex(await readDocument(indexPath)),
    append: async (appends) => await appendEntries(indexPath, appends),
  };
}

// The index is edited in place rather than rewritten, so the Owner's comments, ordering and
// formatting survive a catch-up: what an append changes is the entries it adds and nothing else.
async function appendEntries(
  indexPath: string,
  appends: readonly ShelfIndexAppend[],
): Promise<void> {
  if (appends.length === 0) return;
  const document = await readDocument(indexPath);
  const index = readIndex(document);
  for (const { key, entry } of appends) {
    if (index.books[key] !== undefined) {
      throw new OperationalError(
        "operational-failure",
        `The Shelf index already has an entry for ${key}; renaming or removing one is the Owner's.`,
      );
    }
    document.setIn(["books", key], entryNode(document, entry));
  }
  await writeAtomically(
    indexPath,
    document.toString({ flowCollectionPadding: false }),
  );
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

async function readDocument(indexPath: string): Promise<Document> {
  let contents: string;
  try {
    contents = await readFile(indexPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Document({ books: {} });
    }
    throw unreadableIndex();
  }
  const document = parseDocument(contents);
  if (document.errors.length > 0) throw unreadableIndex();
  return document;
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
      : { edition: readWord(value.edition) }),
    authors: value.authors,
    ...(value.division === undefined
      ? {}
      : { division: readWord(value.division) }),
    sha256: value.sha256,
  };
}

function readWord(value: unknown): string {
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

async function writeAtomically(
  indexPath: string,
  contents: string,
): Promise<void> {
  const temporary = join(
    dirname(indexPath),
    `.${SHELF_INDEX_FILENAME}-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, indexPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
