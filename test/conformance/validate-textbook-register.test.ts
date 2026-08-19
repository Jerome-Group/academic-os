import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateTextbookRegister } from "../../src/conformance/index.js";
import { seededTextbookRegister } from "../fixtures/textbook-register.js";
import { recordFindingEvidence } from "../support/rule-evidence.js";

const cut = `extractions:
  - book: Rosen
    number: 3
    title: Algorithms
    pages: [187, 244]
    file: MH2100_Rosen_Chapter_03_Algorithms.pdf
    source_sha256: ${"a".repeat(64)}
  - book: Isaacs_FGT
    number: IX
    title: The Real Numbers
    pages: [1, 1]
    file: MH2100_Isaacs_FGT_Chapter_09_The_Real_Numbers.pdf
    source_sha256: ${"b".repeat(64)}
`;

function validate(source: string | undefined) {
  return validateTextbookRegister(source, "MH2100");
}

describe("validateTextbookRegister", () => {
  it("accepts the seeded skeleton and a register of cuts [MF-TEXTBOOK-003]", () => {
    const seeded = validate(seededTextbookRegister);
    const recorded = validate(cut);

    assert.equal(seeded.status, "pass");
    assert.match(seeded.evidence, /records 0 extractions/u);
    assert.equal(recorded.status, "pass");
    assert.match(recorded.evidence, /records 2 extractions of 2 books/u);
    recordFindingEvidence([seeded, recorded], "MF-TEXTBOOK-003");
  });

  it("reports an absent, unparseable, or shapeless register", () => {
    const absent = validate(undefined);
    const unparseable = validate("extractions: [\n");
    const shapeless = validate("extractions: {}\n");

    assert.deepEqual(
      [absent, unparseable, shapeless].map(({ ruleId, status, path }) => ({
        ruleId,
        status,
        path,
      })),
      Array.from({ length: 3 }, () => ({
        ruleId: "MF-TEXTBOOK-003",
        status: "fail",
        path: "00 Module Admin/50 Textbook Register.yaml",
      })),
    );
    assert.match(absent.evidence, /No readable control/u);
    assert.match(unparseable.evidence, /YAML parser reported/u);
    assert.match(shapeless.evidence, /requires an extractions sequence/u);
  });

  it("reports an entry missing what the cut is traced back by", () => {
    const bookless = validate(cut.replace("book: Rosen", "book: ''"));
    const untitled = validate(cut.replace("    title: Algorithms\n", ""));

    assert.equal(bookless.status, "fail");
    assert.match(
      bookless.evidence,
      /Extraction 1 book must be a Shelf-index key/u,
    );
    assert.equal(untitled.status, "fail");
    assert.match(
      untitled.evidence,
      /Extraction 1 title must be the full title/u,
    );
  });

  it("reports a number the book does not print", () => {
    const wordy = validate(cut.replace("number: IX", "number: banana"));
    const listed = validate(cut.replace("number: 3", "number: []"));
    const roman = validate(cut.replace("number: 3", "number: XIV"));
    const appendix = validate(cut.replace("number: 3", "number: A"));

    for (const finding of [wordy, listed]) {
      assert.equal(finding.status, "fail");
      assert.match(
        finding.evidence,
        /number must be the number the book prints/u,
      );
    }
    assert.equal(roman.status, "pass");
    assert.equal(appendix.status, "pass");
  });

  it("reports a page range that is not absolute and inclusive", () => {
    const backwards = validate(cut.replace("[187, 244]", "[244, 187]"));
    const open = validate(cut.replace("[187, 244]", "[187]"));
    const unnumbered = validate(cut.replace("[187, 244]", "[0, 244]"));

    for (const finding of [backwards, open, unnumbered]) {
      assert.equal(finding.status, "fail");
      assert.match(
        finding.evidence,
        /Extraction 1 pages must be an inclusive \[first, last\] range of absolute PDF pages/u,
      );
    }
  });

  it("reports a checksum that cannot be compared against the index", () => {
    const truncated = validate(cut.replace("a".repeat(64), "a".repeat(63)));

    assert.equal(truncated.status, "fail");
    assert.match(
      truncated.evidence,
      /Extraction 1 source_sha256 must be the book's sha-256/u,
    );
  });

  it("reports an entry repeating what the Shelf index owns", () => {
    const bookLevel = validate(
      cut.replace("    number: 3\n", "    number: 3\n    edition: 8e\n"),
    );

    assert.equal(bookLevel.status, "fail");
    assert.match(
      bookLevel.evidence,
      /Extraction 1 carries edition, which the Shelf index owns/u,
    );
  });

  it("holds the recorded file to the chapter name the folder is audited by", () => {
    const offPattern = validate(
      cut.replace(
        "file: MH2100_Rosen_Chapter_03_Algorithms.pdf",
        "file: MH2100_Rosen_Algorithms.pdf",
      ),
    );
    const elsewhere = validate(
      cut.replace(
        "file: MH2100_Rosen_Chapter_03_Algorithms.pdf",
        "file: 10 Learning Materials/20 Textbook Chapters/MH2100_Rosen_Chapter_03_Algorithms.pdf",
      ),
    );

    for (const finding of [offPattern, elsewhere]) {
      assert.equal(finding.status, "fail");
      assert.match(
        finding.evidence,
        /Extraction 1 file must name one MH2100_<Key>_<Division>_<NN>_<Title>\.pdf in 10 Learning Materials\/20 Textbook Chapters/u,
      );
    }
  });

  it("reports two cuts claiming one chapter file", () => {
    const collided = validate(
      cut.replace(
        "MH2100_Isaacs_FGT_Chapter_09_The_Real_Numbers.pdf",
        "MH2100_Rosen_Chapter_03_Algorithms.pdf",
      ),
    );

    assert.equal(collided.status, "fail");
    assert.match(
      collided.evidence,
      /Extraction 2 file MH2100_Rosen_Chapter_03_Algorithms\.pdf is already recorded by extraction 1/u,
    );
  });
});
