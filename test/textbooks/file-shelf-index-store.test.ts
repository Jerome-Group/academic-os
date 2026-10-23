import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  createFileShelfIndexReader,
  SHELF_INDEX_FILENAME,
  type ShelfIndexAppend,
} from "../../src/textbooks/index.js";
import {
  appendShelfEntries,
  readShelfIndexDocument,
} from "../../src/textbooks/file-shelf-index-store.js";

const roots: string[] = [];
const ownerIndex = `# Shelf\nowner: retained\nbooks:\n  Rosen:\n    file: Discrete Mathematics 8e Rosen.pdf\n    title: Discrete Mathematics\n    authors: [Rosen]\n    division: Chapter # Owner word\n    extra: retained\n    sha256: ${"a".repeat(64)}\n`;
const axler: ShelfIndexAppend = {
  key: "Axler",
  entry: {
    file: "Linear Algebra 4e Axler.pdf",
    title: "Linear Algebra",
    authors: ["Axler"],
    sha256: "b".repeat(64),
  },
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Shelf index documents", () => {
  it("reads the Owner facts and genuine absence", async () => {
    const shelf = await fixture();
    assert.deepEqual(await createFileShelfIndexReader(shelf).read(), {
      books: {},
    });
    await writeFile(join(shelf, SHELF_INDEX_FILENAME), ownerIndex);
    assert.equal(
      (await createFileShelfIndexReader(shelf).read()).books.Rosen?.division,
      "Chapter",
    );
  });

  it("adds nodes after existing Owner comments, fields and order", async () => {
    const shelf = await fixture(ownerIndex);
    const { document } = await readShelfIndexDocument(shelf);
    const output = appendShelfEntries(document, [axler]);
    assert.ok(output.startsWith(ownerIndex));
    assert.match(output, / {2}Axler:\n/u);
    assert.equal(
      await readFile(join(shelf, SHELF_INDEX_FILENAME), "utf8"),
      ownerIndex,
    );
  });

  for (const contents of [
    "books: null\n",
    "books:\n",
    "",
    "# Owner\nbooks: ~\n",
  ]) {
    it(`constructs an append to empty YAML ${JSON.stringify(contents)}`, async () => {
      const shelf = await fixture(contents);
      const { document } = await readShelfIndexDocument(shelf);
      const output = appendShelfEntries(document, [axler]);
      assert.match(output, /Axler:/u);
      if (contents.includes("#")) assert.match(output, /# Owner/u);
    });
  }

  it("validates the complete batch before modifying nodes", async () => {
    const shelf = await fixture(ownerIndex);
    const { document } = await readShelfIndexDocument(shelf);
    assert.throws(
      () =>
        appendShelfEntries(document, [
          axler,
          { key: "Rosen", entry: axler.entry },
        ]),
      /Duplicate Shelf append/u,
    );
    assert.equal(
      document.toString({ flowCollectionPadding: false }),
      ownerIndex,
    );
  });

  for (const contents of [
    "books:\n  Rosen: a book\n",
    "books: [",
    Buffer.from([0xff, 0xfe]),
  ]) {
    it("refuses corrupt data instead of interpreting it as absence", async () => {
      const shelf = await fixture(contents);
      await assert.rejects(createFileShelfIndexReader(shelf).read());
    });
  }
});

async function fixture(contents?: string | Buffer): Promise<string> {
  const shelf = await mkdtemp(join(tmpdir(), "academic-os-index-"));
  roots.push(shelf);
  if (contents !== undefined)
    await writeFile(join(shelf, SHELF_INDEX_FILENAME), contents);
  return shelf;
}
