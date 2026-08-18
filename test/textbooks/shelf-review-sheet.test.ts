import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
    const review = readShelfReviewSheet(
      renderShelfReviewSheet({ sweep, shelf: "/shelf" }),
    );

    assert.deepEqual(review.books[0], {
      file: "Linear Algebra Done Right 4e Axler.pdf",
      sha256: "b".repeat(64),
      key: "Axler",
    });
  });

  it("leaves a settleable book with neither rename nor key, and asks in a comment", () => {
    const sheet = renderShelfReviewSheet({ sweep, shelf: "/shelf" });

    assert.deepEqual(readShelfReviewSheet(sheet).books[1], {
      file: "Isaacs - Algebra.pdf",
      sha256: "c".repeat(64),
    });
    assert.match(sheet, /# SETTLE — set `rename` to a conforming filename/u);
    assert.match(
      sheet,
      /# The filename does not follow the codified naming\./u,
    );
  });

  it("reads back what the Owner settled", () => {
    const review = readShelfReviewSheet(`schemaVersion: 1
shelf: /shelf
books:
  - file: Isaacs - Algebra.pdf
    sha256: ${"c".repeat(64)}
    rename: Algebra A Graduate Course Isaacs.pdf
    key: Isaacs_Algebra
`);

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
        readShelfReviewSheet(`schemaVersion: 1
books:
  - file: Analysis I 4e Tao.pdf
    sha256: ${"h".repeat(64)}
    keyy: Tao
`),
      /not a readable shelf review sheet/u,
    );
  });

  it("refuses a sheet whose pinned checksum is not a checksum", () => {
    assert.throws(
      () =>
        readShelfReviewSheet(`schemaVersion: 1
books:
  - file: Analysis I 4e Tao.pdf
    sha256: unknown
    key: Tao
`),
      /not a readable shelf review sheet/u,
    );
  });

  it("refuses a sheet of another schema version", () => {
    assert.throws(
      () => readShelfReviewSheet("schemaVersion: 2\nbooks: []\n"),
      /not a readable shelf review sheet/u,
    );
  });
});
