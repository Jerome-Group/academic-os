import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planShelfSweep,
  type ShelfIndex,
  type ShelfReader,
} from "../../src/textbooks/index.js";

const rosen = "Discrete Mathematics and Its Applications 8e Rosen.pdf";
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

describe("the shelf sweep", () => {
  it("derives the default key of a cleanly named book and asks nothing of the Owner", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({
        "Linear Algebra Done Right 4e Axler.pdf": "b".repeat(64),
      }),
      index: { books: {} },
    });

    assert.deepEqual(sweep.books, [
      {
        file: "Linear Algebra Done Right 4e Axler.pdf",
        sha256: "b".repeat(64),
        key: "Axler",
      },
    ]);
    assert.deepEqual(sweep.counts, { books: 1, indexed: 0, settle: 0 });
  });

  it("leaves a book the index already names out of the sheet", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({ [rosen]: "a".repeat(64) }),
      index: indexedRosen,
    });

    assert.deepEqual(sweep.books, []);
    assert.deepEqual(sweep.counts, { books: 1, indexed: 1, settle: 0 });
  });

  it("flags an unparseable name for the Owner to rename, and derives no key for it", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({ "Isaacs - Algebra.pdf": "c".repeat(64) }),
      index: { books: {} },
    });

    assert.deepEqual(sweep.books, [
      {
        file: "Isaacs - Algebra.pdf",
        sha256: "c".repeat(64),
        settle: "unparseable-name",
        note: "The filename does not follow <Title> <N>e <Author surnames, comma-separated>.pdf.",
      },
    ]);
    assert.deepEqual(sweep.counts, { books: 1, indexed: 0, settle: 1 });
  });

  it("flags the second of two shelf books claiming one key, naming the holder", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({
        "Character Theory of Finite Groups Isaacs.pdf": "d".repeat(64),
        "Finite Group Theory Isaacs.pdf": "e".repeat(64),
      }),
      index: { books: {} },
    });

    assert.deepEqual(
      sweep.books.map(({ file, key, settle }) => ({ file, key, settle })),
      [
        {
          file: "Character Theory of Finite Groups Isaacs.pdf",
          key: "Isaacs",
          settle: undefined,
        },
        {
          file: "Finite Group Theory Isaacs.pdf",
          key: undefined,
          settle: "key-collision",
        },
      ],
    );
    assert.match(sweep.books[1]?.note ?? "", /Character Theory/u);
    assert.deepEqual(sweep.counts, { books: 2, indexed: 0, settle: 1 });
  });

  it("flags a book whose default key an index entry already holds", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({
        "Discrete Mathematics and Its Applications 9e Rosen.pdf": "f".repeat(
          64,
        ),
      }),
      index: indexedRosen,
    });

    assert.equal(sweep.books[0]?.settle, "key-collision");
    assert.match(sweep.books[0]?.note ?? "", /Rosen/u);
  });

  it("leaves the plain key to the book its solutions manual answers", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({
        "Linear Algebra Done Right 4e Axler Solutions.pdf": "g".repeat(64),
        "Linear Algebra Done Right 4e Axler.pdf": "b".repeat(64),
      }),
      index: { books: {} },
    });

    assert.deepEqual(
      sweep.books.map(({ file, key }) => ({ file, key })),
      [
        { file: "Linear Algebra Done Right 4e Axler.pdf", key: "Axler" },
        {
          file: "Linear Algebra Done Right 4e Axler Solutions.pdf",
          key: undefined,
        },
      ],
    );
    assert.equal(sweep.books[1]?.settle, "key-collision");
  });

  it("flags the second of two shelf copies of one book, naming the first", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({
        "Analysis I 4e Tao.pdf": "h".repeat(64),
        "Analysis I 4e Terence.pdf": "h".repeat(64),
      }),
      index: { books: {} },
    });

    assert.equal(sweep.books[1]?.file, "Analysis I 4e Terence.pdf");
    assert.equal(sweep.books[1]?.settle, "checksum-duplicate");
    assert.match(sweep.books[1]?.note ?? "", /Analysis I 4e Tao\.pdf/u);
  });

  it("flags a book whose bytes the index already holds under another name", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({
        "Discrete Mathematics and Its Applications 8e Krantz.pdf": "a".repeat(
          64,
        ),
      }),
      index: indexedRosen,
    });

    assert.equal(sweep.books[0]?.settle, "checksum-duplicate");
    assert.match(sweep.books[0]?.note ?? "", /Rosen/u);
  });

  it("flags a conforming copy of bytes an unparseable name brought onto the shelf", async () => {
    const sweep = await planShelfSweep({
      reader: syntheticShelf({
        "Algebra - A Graduate Course Isaacs.pdf": "c".repeat(64),
        "Algebra A Graduate Course Isaacs.pdf": "c".repeat(64),
      }),
      index: { books: {} },
    });

    assert.equal(sweep.books[1]?.file, "Algebra A Graduate Course Isaacs.pdf");
    assert.equal(sweep.books[1]?.settle, "checksum-duplicate");
    assert.match(sweep.books[1]?.note ?? "", /Algebra - A Graduate Course/u);
    assert.equal(sweep.counts.settle, 2);
  });

  it("never reads the bytes of a book the index already names", async () => {
    const shelf = syntheticShelf({
      [rosen]: "a".repeat(64),
      "Analysis I 4e Tao.pdf": "h".repeat(64),
    });

    await planShelfSweep({ reader: shelf, index: indexedRosen });

    assert.deepEqual(shelf.checksummed, ["Analysis I 4e Tao.pdf"]);
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
