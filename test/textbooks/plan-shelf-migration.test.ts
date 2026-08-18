import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planShelfMigration,
  type ShelfIndex,
  type ShelfReader,
  type ShelfReview,
} from "../../src/textbooks/index.js";

const isaacs = "Algebra - A Graduate Course Isaacs.pdf";
const renamedIsaacs = "Algebra A Graduate Course Isaacs.pdf";
const axler = "Linear Algebra Done Right 4e Axler.pdf";

describe("the shelf migration plan", () => {
  it("renames what the Owner approved and indexes the settled key against it", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({ [isaacs]: "c".repeat(64) }),
      index: { books: {} },
      review: reviewOf({
        file: isaacs,
        sha256: "c".repeat(64),
        rename: renamedIsaacs,
        key: "Isaacs_Algebra",
      }),
    });

    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.renames, [{ from: isaacs, to: renamedIsaacs }]);
    assert.deepEqual(plan.appends, [
      {
        key: "Isaacs_Algebra",
        entry: {
          file: renamedIsaacs,
          title: "Algebra A Graduate Course",
          authors: ["Isaacs"],
          sha256: "c".repeat(64),
        },
      },
    ]);
  });

  it("indexes a book the Owner left alone without renaming it", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({ [axler]: "b".repeat(64) }),
      index: { books: {} },
      review: reviewOf({ file: axler, sha256: "b".repeat(64), key: "Axler" }),
    });

    assert.deepEqual(plan.renames, []);
    assert.deepEqual(plan.appends[0]?.entry, {
      file: axler,
      title: "Linear Algebra Done Right",
      edition: "4e",
      authors: ["Axler"],
      sha256: "b".repeat(64),
    });
  });

  it("blocks on a book the Owner has not given a key", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({ [axler]: "b".repeat(64) }),
      index: { books: {} },
      review: reviewOf({ file: axler, sha256: "b".repeat(64) }),
    });

    assert.deepEqual(plan.blockers, [`${axler} has no settled Book key.`]);
    assert.deepEqual(plan.appends, []);
  });

  it("blocks on a rename that still does not follow the codified naming", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({ [isaacs]: "c".repeat(64) }),
      index: { books: {} },
      review: reviewOf({
        file: isaacs,
        sha256: "c".repeat(64),
        rename: "Isaacs - Algebra.pdf",
        key: "Isaacs",
      }),
    });

    assert.equal(plan.blockers.length, 1);
    assert.match(plan.blockers[0] ?? "", /does not follow/u);
  });

  it("blocks on a key an index entry already holds", async () => {
    const indexed: ShelfIndex = {
      books: {
        Axler: {
          file: "Linear Algebra Done Right 3e Axler.pdf",
          title: "Linear Algebra Done Right",
          edition: "3e",
          authors: ["Axler"],
          sha256: "z".repeat(64),
        },
      },
    };

    const plan = await planShelfMigration({
      reader: syntheticShelf({
        "Linear Algebra Done Right 3e Axler.pdf": "z".repeat(64),
        [axler]: "b".repeat(64),
      }),
      index: indexed,
      review: reviewOf({ file: axler, sha256: "b".repeat(64), key: "Axler" }),
    });

    assert.deepEqual(plan.blockers, [
      "The Book key Axler already names Linear Algebra Done Right 3e Axler.pdf.",
    ]);
  });

  it("blocks on two books settled to one key", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({
        "Character Theory of Finite Groups Isaacs.pdf": "d".repeat(64),
        "Finite Group Theory Isaacs.pdf": "e".repeat(64),
      }),
      index: { books: {} },
      review: {
        books: [
          {
            file: "Character Theory of Finite Groups Isaacs.pdf",
            sha256: "d".repeat(64),
            key: "Isaacs",
          },
          {
            file: "Finite Group Theory Isaacs.pdf",
            sha256: "e".repeat(64),
            key: "Isaacs",
          },
        ],
      },
    });

    assert.match(plan.blockers[0] ?? "", /Book key Isaacs already names/u);
    assert.equal(plan.appends.length, 1);
  });

  it("blocks on a key that is not a filename-safe token", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({ [axler]: "b".repeat(64) }),
      index: { books: {} },
      review: reviewOf({
        file: axler,
        sha256: "b".repeat(64),
        key: "Axler Solutions",
      }),
    });

    assert.match(plan.blockers[0] ?? "", /not a capitalised, filename-safe/u);
  });

  it("blocks when a book has arrived on the shelf since the sweep", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({
        [axler]: "b".repeat(64),
        "Analysis I 4e Tao.pdf": "h".repeat(64),
      }),
      index: { books: {} },
      review: reviewOf({ file: axler, sha256: "b".repeat(64), key: "Axler" }),
    });

    assert.deepEqual(plan.blockers, [
      "Analysis I 4e Tao.pdf is on the shelf and not in the review sheet.",
      "The shelf has moved under the review sheet; sweep again.",
    ]);
  });

  it("blocks when a book in the sheet has left the shelf", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({ [axler]: "b".repeat(64) }),
      index: { books: {} },
      review: {
        books: [
          { file: axler, sha256: "b".repeat(64), key: "Axler" },
          { file: "Analysis I 4e Tao.pdf", sha256: "h".repeat(64), key: "Tao" },
        ],
      },
    });

    assert.deepEqual(
      plan.blockers[0],
      "Analysis I 4e Tao.pdf is in the review sheet and not on the shelf.",
    );
  });

  it("blocks when the copy on the shelf is not the copy the sheet pinned", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({ [axler]: "b".repeat(64) }),
      index: { books: {} },
      review: reviewOf({ file: axler, sha256: "0".repeat(64), key: "Axler" }),
    });

    assert.deepEqual(plan.blockers, [
      `${axler} is not the copy the review sheet pinned.`,
    ]);
  });

  it("blocks two sheet lines carrying the same bytes, whatever the Owner settled them as", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({
        "Analysis I 4e Tao.pdf": "h".repeat(64),
        "Analysis I 4e Terence.pdf": "h".repeat(64),
      }),
      index: { books: {} },
      review: {
        books: [
          { file: "Analysis I 4e Tao.pdf", sha256: "h".repeat(64), key: "Tao" },
          {
            file: "Analysis I 4e Terence.pdf",
            sha256: "h".repeat(64),
            key: "Terence",
          },
        ],
      },
    });

    assert.match(plan.blockers[0] ?? "", /carries the same bytes as/u);
    assert.equal(plan.appends.length, 1);
  });

  it("blocks a sheet line carrying bytes an index entry already holds", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({
        "Discrete Mathematics and Its Applications 8e Rosen.pdf": "a".repeat(
          64,
        ),
        "Discrete Mathematics and Its Applications 8e Krantz.pdf": "a".repeat(
          64,
        ),
      }),
      index: {
        books: {
          Rosen: {
            file: "Discrete Mathematics and Its Applications 8e Rosen.pdf",
            title: "Discrete Mathematics and Its Applications",
            edition: "8e",
            authors: ["Rosen"],
            sha256: "a".repeat(64),
          },
        },
      },
      review: reviewOf({
        file: "Discrete Mathematics and Its Applications 8e Krantz.pdf",
        sha256: "a".repeat(64),
        key: "Krantz",
      }),
    });

    assert.match(plan.blockers[0] ?? "", /carries the same bytes as/u);
    assert.deepEqual(plan.appends, []);
  });

  it("records a Division word the Owner knew without being asked for one", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({ [axler]: "b".repeat(64) }),
      index: { books: {} },
      review: reviewOf({
        file: axler,
        sha256: "b".repeat(64),
        key: "Axler",
        division: "Chapter",
      }),
    });

    assert.equal(plan.appends[0]?.entry.division, "Chapter");
  });

  it("blocks on a rename that would land on a book the index already names", async () => {
    const older = "Linear Algebra Done Right 3e Axler.pdf";
    const plan = await planShelfMigration({
      reader: syntheticShelf({
        [older]: "z".repeat(64),
        [isaacs]: "c".repeat(64),
      }),
      index: {
        books: {
          Axler: {
            file: older,
            title: "Linear Algebra Done Right",
            edition: "3e",
            authors: ["Axler"],
            sha256: "z".repeat(64),
          },
        },
      },
      review: reviewOf({
        file: isaacs,
        sha256: "c".repeat(64),
        rename: older,
        key: "Isaacs",
      }),
    });

    assert.deepEqual(plan.blockers, [
      `Naming ${isaacs} ${older} would land on ${older}.`,
    ]);
    assert.deepEqual(plan.renames, []);
  });

  it("blocks on two books renamed to the same name", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({
        "Analysis I Tao.pdf": "h".repeat(64),
        "Analysis I Terence.pdf": "i".repeat(64),
      }),
      index: { books: {} },
      review: {
        books: [
          {
            file: "Analysis I Tao.pdf",
            sha256: "h".repeat(64),
            rename: "Analysis I 4e Tao.pdf",
            key: "Tao",
          },
          {
            file: "Analysis I Terence.pdf",
            sha256: "i".repeat(64),
            rename: "Analysis I 4e Tao.pdf",
            key: "Tao_II",
          },
        ],
      },
    });

    assert.match(plan.blockers[0] ?? "", /would land on Analysis I Tao\.pdf/u);
  });

  it("blocks on a rename onto a name another rename is vacating", async () => {
    const plan = await planShelfMigration({
      reader: syntheticShelf({
        "Analysis I 4e Tao.pdf": "h".repeat(64),
        "Analysis II Tao.pdf": "i".repeat(64),
      }),
      index: { books: {} },
      review: {
        books: [
          {
            file: "Analysis I 4e Tao.pdf",
            sha256: "h".repeat(64),
            rename: "Analysis I 5e Tao.pdf",
            key: "Tao_I",
          },
          {
            file: "Analysis II Tao.pdf",
            sha256: "i".repeat(64),
            rename: "Analysis I 4e Tao.pdf",
            key: "Tao_II",
          },
        ],
      },
    });

    assert.match(plan.blockers[0] ?? "", /another rename moves away/u);
  });
});

function reviewOf(...books: ShelfReview["books"]): ShelfReview {
  return { books };
}

function syntheticShelf(books: Record<string, string>): ShelfReader {
  return {
    listBooks: async () => Object.keys(books).sort(),
    checksum: async (file) => {
      const sha256 = books[file];
      if (sha256 === undefined) throw new Error(`No such book: ${file}.`);
      return sha256;
    },
  };
}
