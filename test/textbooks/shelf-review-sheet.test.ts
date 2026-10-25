import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Document } from "yaml";

import {
  readShelfReviewSheet,
  renderShelfReviewSheet,
  type ShelfSweep,
} from "../../src/textbooks/index.js";

const sweep: ShelfSweep = {
  counts: { books: 2, indexed: 0, settle: 1 },
  books: [
    {
      file: "Linear Algebra Done Right 4e Axler.pdf",
      sha256: "b".repeat(64),
      key: "Axler",
    },
    {
      file: "Isaacs - Algebra.pdf",
      sha256: "c".repeat(64),
      settle: "unparseable-name",
      note: "The filename does not follow the codified naming.",
    },
  ],
};

describe("the shelf review sheet", () => {
  it("carries the derived key of a book that needs no settling, and a blank rename", () => {
    const review = readShelfReviewSheet({
      contents: renderShelfReviewSheet({ sweep, shelf: "/shelf" }),
      shelfRoot: "/shelf",
    });

    assert.deepEqual(review.books[0], {
      file: "Linear Algebra Done Right 4e Axler.pdf",
      sha256: "b".repeat(64),
      key: "Axler",
    });
  });

  it("leaves a settleable book with neither rename nor key, and asks in a comment", () => {
    const sheet = renderShelfReviewSheet({ sweep, shelf: "/shelf" });

    assert.deepEqual(
      readShelfReviewSheet({ contents: sheet, shelfRoot: "/shelf" }).books[1],
      {
        file: "Isaacs - Algebra.pdf",
        sha256: "c".repeat(64),
      },
    );
    assert.match(sheet, /# SETTLE — set `rename` to a conforming filename/u);
    assert.match(
      sheet,
      /# The filename does not follow the codified naming\./u,
    );
  });

  it("never folds a long filename across two lines", () => {
    const long =
      "The Elements of Statistical Learning Data Mining Inference and Prediction 2e Hastie, Tibshirani, Friedman.pdf";
    const sheet = renderShelfReviewSheet({
      sweep: {
        counts: { books: 1, indexed: 0, settle: 0 },
        books: [{ file: long, sha256: "d".repeat(64), key: "Hastie" }],
      },
      shelf: "/shelf",
    });

    assert.match(
      sheet,
      new RegExp(`- file: ${long.replaceAll(".", "\\.")}\n`, "u"),
    );
  });

  it("reads back what the Owner settled", () => {
    const review = readShelfReviewSheet({
      contents: `schemaVersion: 1
shelf: /shelf
books:
  - file: Isaacs - Algebra.pdf
    sha256: ${"c".repeat(64)}
    rename: Algebra A Graduate Course Isaacs.pdf
    key: Isaacs_Algebra
`,
      shelfRoot: "/shelf",
    });

    assert.deepEqual(review.books, [
      {
        file: "Isaacs - Algebra.pdf",
        sha256: "c".repeat(64),
        rename: "Algebra A Graduate Course Isaacs.pdf",
        key: "Isaacs_Algebra",
      },
    ]);
  });

  it("refuses a sheet carrying a field it does not know", () => {
    assert.throws(
      () =>
        readShelfReviewSheet({
          contents: `schemaVersion: 1
shelf: /shelf
books:
  - file: Analysis I 4e Tao.pdf
    sha256: ${"h".repeat(64)}
    keyy: Tao
`,
          shelfRoot: "/shelf",
        }),
      /not a readable shelf review sheet/u,
    );
  });

  it("refuses a sheet whose pinned checksum is not a checksum", () => {
    assert.throws(
      () =>
        readShelfReviewSheet({
          contents: `schemaVersion: 1
shelf: /shelf
books:
  - file: Analysis I 4e Tao.pdf
    sha256: unknown
    key: Tao
`,
          shelfRoot: "/shelf",
        }),
      /not a readable shelf review sheet/u,
    );
  });

  it("refuses a sheet of another schema version", () => {
    assert.throws(
      () =>
        readShelfReviewSheet({
          contents: "schemaVersion: 2\nbooks: []\n",
          shelfRoot: "/shelf",
        }),
      /not a readable shelf review sheet/u,
    );
  });

  for (const shelf of [
    undefined,
    null,
    "",
    " /shelf",
    "/shelf ",
    "shelf",
    23,
    [],
    {},
  ]) {
    it(`refuses an invalid Shelf identity ${JSON.stringify(shelf)}`, () => {
      const sheet = new Document({
        schemaVersion: 1,
        books: [],
        ...(shelf === undefined ? {} : { shelf }),
      });

      assert.throws(
        () =>
          readShelfReviewSheet({
            contents: sheet.toString(),
            shelfRoot: "/shelf",
          }),
        /not a readable shelf review sheet/u,
      );
    });
  }

  it("refuses a changed target instead of rebinding the review", () => {
    assert.throws(
      () =>
        readShelfReviewSheet({
          contents: renderShelfReviewSheet({ sweep, shelf: "/original-shelf" }),
          shelfRoot: "/shelf",
        }),
      /review sheet belongs to another Textbook Shelf/u,
    );
  });
});
