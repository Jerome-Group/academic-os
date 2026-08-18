import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planShelfCatchUp,
  type ShelfIndex,
  type ShelfReader,
} from "../../src/textbooks/index.js";

const rosen = "Discrete Mathematics and Its Applications 8e Rosen.pdf";
const axler = "Linear Algebra Done Right 4e Axler.pdf";
const indexedRosen: ShelfIndex = {
  books: {
    Rosen: {
      file: rosen,
      title: "Discrete Mathematics and Its Applications",
      edition: "8e",
      authors: ["Rosen"],
      division: "Chapter",
      sha256: "a".repeat(64),
    },
  },
};

describe("the shelf catch-up plan", () => {
  it("appends a cleanly named book whose default key is free", async () => {
    const shelf = syntheticShelf({ [axler]: "b".repeat(64) });

    const plan = await planShelfCatchUp({ reader: shelf, index: indexedRosen });

    assert.deepEqual(plan.appends, [
      {
        key: "Axler",
        entry: {
          file: axler,
          title: "Linear Algebra Done Right",
          edition: "4e",
          authors: ["Axler"],
          sha256: "b".repeat(64),
        },
      },
    ]);
    assert.deepEqual(plan.parked, []);
    assert.deepEqual(plan.counts, { books: 1, indexed: 0 });
  });

  it("leaves the plain key to the book its solutions manual answers", async () => {
    const shelf = syntheticShelf({
      "Linear Algebra Done Right 4e Axler Solutions.pdf": "c".repeat(64),
      [axler]: "b".repeat(64),
    });

    const plan = await planShelfCatchUp({
      reader: shelf,
      index: { books: {} },
    });

    assert.deepEqual(plan.appends, [
      {
        key: "Axler",
        entry: {
          file: axler,
          title: "Linear Algebra Done Right",
          edition: "4e",
          authors: ["Axler"],
          sha256: "b".repeat(64),
        },
      },
    ]);
    assert.equal(
      plan.parked[0]?.file,
      "Linear Algebra Done Right 4e Axler Solutions.pdf",
    );
    assert.equal(plan.parked[0]?.reason, "key-collision");
  });

  it("leaves a book the index already names alone, and never reads its bytes", async () => {
    const shelf = syntheticShelf({ [rosen]: "a".repeat(64) });

    const plan = await planShelfCatchUp({ reader: shelf, index: indexedRosen });

    assert.deepEqual(plan.appends, []);
    assert.deepEqual(plan.parked, []);
    assert.deepEqual(plan.counts, { books: 1, indexed: 1 });
    assert.deepEqual(shelf.checksummed, []);
  });

  it("parks a name the codified naming does not accept", async () => {
    const shelf = syntheticShelf({
      "Rosen - Discrete Maths.pdf": "d".repeat(64),
    });

    const plan = await planShelfCatchUp({ reader: shelf, index: indexedRosen });

    assert.deepEqual(plan.appends, []);
    assert.equal(plan.parked.length, 1);
    assert.equal(plan.parked[0]?.file, "Rosen - Discrete Maths.pdf");
    assert.equal(plan.parked[0]?.reason, "unparseable-name");
    assert.deepEqual(shelf.checksummed, []);
  });

  it("parks a book whose default key the index already holds", async () => {
    const newerRosen = "Discrete Mathematics and Its Applications 9e Rosen.pdf";
    const shelf = syntheticShelf({ [newerRosen]: "e".repeat(64) });

    const plan = await planShelfCatchUp({ reader: shelf, index: indexedRosen });

    assert.deepEqual(plan.appends, []);
    assert.equal(plan.parked[0]?.reason, "key-collision");
    assert.match(plan.parked[0]?.note ?? "", /Rosen/u);
  });

  it("parks the second of two shelf books claiming one key", async () => {
    const shelf = syntheticShelf({
      "Algebra 1e Isaacs.pdf": "f".repeat(64),
      "Character Theory 2e Isaacs.pdf": "g".repeat(64),
    });

    const plan = await planShelfCatchUp({
      reader: shelf,
      index: { books: {} },
    });

    assert.deepEqual(
      plan.appends.map(({ key }) => key),
      ["Isaacs"],
    );
    assert.equal(plan.parked[0]?.file, "Character Theory 2e Isaacs.pdf");
    assert.equal(plan.parked[0]?.reason, "key-collision");
  });

  it("parks a book whose bytes the index already holds under another name", async () => {
    const shelf = syntheticShelf({
      "Discrete Mathematics and Its Applications 8e Krantz.pdf": "a".repeat(64),
    });

    const plan = await planShelfCatchUp({ reader: shelf, index: indexedRosen });

    assert.deepEqual(plan.appends, []);
    assert.equal(plan.parked[0]?.reason, "checksum-duplicate");
    assert.match(plan.parked[0]?.note ?? "", /Rosen/u);
  });

  it("parks the second of two shelf copies of one book", async () => {
    const shelf = syntheticShelf({
      "Analysis I Tao.pdf": "h".repeat(64),
      "Analysis I Terence.pdf": "h".repeat(64),
    });

    const plan = await planShelfCatchUp({
      reader: shelf,
      index: { books: {} },
    });

    assert.deepEqual(
      plan.appends.map(({ key }) => key),
      ["Tao"],
    );
    assert.equal(plan.parked[0]?.file, "Analysis I Terence.pdf");
    assert.equal(plan.parked[0]?.reason, "checksum-duplicate");
  });
});

function syntheticShelf(
  books: Record<string, string>,
): ShelfReader & { checksummed: string[] } {
  const checksummed: string[] = [];
  return {
    checksummed,
    listBooks: async () => Object.keys(books).sort(),
    checksum: async (file) => {
      checksummed.push(file);
      const sha256 = books[file];
      if (sha256 === undefined) throw new Error(`No such book: ${file}.`);
      return sha256;
    },
  };
}
