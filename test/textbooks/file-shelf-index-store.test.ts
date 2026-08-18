import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  createFileShelfIndexStore,
  SHELF_INDEX_FILENAME,
  type ShelfIndexAppend,
} from "../../src/textbooks/index.js";

const temporaryRoots: string[] = [];

const ownerWrittenIndex = [
  "books:",
  "  Rosen:",
  "    file: Discrete Mathematics and Its Applications 8e Rosen.pdf",
  "    title: Discrete Mathematics and Its Applications",
  "    edition: 8e",
  "    authors: [Rosen]",
  "    division: Chapter # the book's own word",
  `    sha256: ${"a".repeat(64)}`,
  "",
].join("\n");

const axler: ShelfIndexAppend = {
  key: "Axler",
  entry: {
    file: "Linear Algebra Done Right 4e Axler.pdf",
    title: "Linear Algebra Done Right",
    edition: "4e",
    authors: ["Axler"],
    sha256: "b".repeat(64),
  },
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("the Shelf index on a shelf", () => {
  it("reads the Owner's entries", async () => {
    const shelf = await shelfWithIndex(ownerWrittenIndex);

    assert.deepEqual(await createFileShelfIndexStore(shelf).read(), {
      books: {
        Rosen: {
          file: "Discrete Mathematics and Its Applications 8e Rosen.pdf",
          title: "Discrete Mathematics and Its Applications",
          edition: "8e",
          authors: ["Rosen"],
          division: "Chapter",
          sha256: "a".repeat(64),
        },
      },
    });
  });

  it("reads a shelf with no index yet as an index with no books", async () => {
    const shelf = await shelfWithIndex(undefined);

    assert.deepEqual(await createFileShelfIndexStore(shelf).read(), {
      books: {},
    });
  });

  it("appends beneath the entries and comments already there", async () => {
    const shelf = await shelfWithIndex(ownerWrittenIndex);

    await createFileShelfIndexStore(shelf).append([axler]);

    assert.equal(
      await readFile(join(shelf, SHELF_INDEX_FILENAME), "utf8"),
      [
        ownerWrittenIndex.trimEnd(),
        "  Axler:",
        "    file: Linear Algebra Done Right 4e Axler.pdf",
        "    title: Linear Algebra Done Right",
        "    edition: 4e",
        "    authors: [Axler]",
        `    sha256: ${"b".repeat(64)}`,
        "",
      ].join("\n"),
    );
  });

  it("writes the first entry onto a shelf with no index", async () => {
    const shelf = await shelfWithIndex(undefined);

    await createFileShelfIndexStore(shelf).append([axler]);

    assert.equal(
      await readFile(join(shelf, SHELF_INDEX_FILENAME), "utf8"),
      [
        "books:",
        "  Axler:",
        "    file: Linear Algebra Done Right 4e Axler.pdf",
        "    title: Linear Algebra Done Right",
        "    edition: 4e",
        "    authors: [Axler]",
        `    sha256: ${"b".repeat(64)}`,
        "",
      ].join("\n"),
    );
  });

  it("refuses to write over an entry the index already holds", async () => {
    const shelf = await shelfWithIndex(ownerWrittenIndex);
    const store = createFileShelfIndexStore(shelf);

    await assert.rejects(
      store.append([{ key: "Rosen", entry: axler.entry }]),
      /Rosen/u,
    );
    assert.equal(
      await readFile(join(shelf, SHELF_INDEX_FILENAME), "utf8"),
      ownerWrittenIndex,
    );
  });

  it("refuses an index it cannot read as one", async () => {
    const shelf = await shelfWithIndex("books:\n  Rosen: a book\n");
    const store = createFileShelfIndexStore(shelf);

    await assert.rejects(store.read(), /Shelf index/u);
    await assert.rejects(store.append([axler]), /Shelf index/u);
  });
});

async function shelfWithIndex(contents: string | undefined): Promise<string> {
  const shelf = await mkdtemp(join(tmpdir(), "academic-os-shelf-"));
  temporaryRoots.push(shelf);
  if (contents !== undefined) {
    await writeFile(join(shelf, SHELF_INDEX_FILENAME), contents);
  }
  return shelf;
}
