import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseShelfFilename } from "../../src/textbooks/index.js";

describe("the codified shelf naming", () => {
  it("reads title, edition and author from a single-author name", () => {
    assert.deepEqual(
      parseShelfFilename(
        "Discrete Mathematics and Its Applications 8e Rosen.pdf",
      ),
      {
        title: "Discrete Mathematics and Its Applications",
        edition: "8e",
        authors: ["Rosen"],
        solutions: false,
      },
    );
  });

  it("reads a comma-separated author list", () => {
    assert.deepEqual(
      parseShelfFilename(
        "Introduction to Algorithms 4e Cormen, Leiserson, Rivest, Stein.pdf",
      ),
      {
        title: "Introduction to Algorithms",
        edition: "4e",
        authors: ["Cormen", "Leiserson", "Rivest", "Stein"],
        solutions: false,
      },
    );
  });

  it("reads a name whose book has no edition", () => {
    assert.deepEqual(parseShelfFilename("Analysis I Tao.pdf"), {
      title: "Analysis I",
      authors: ["Tao"],
      solutions: false,
    });
  });

  it("reads the trailing Solutions qualifier", () => {
    assert.deepEqual(
      parseShelfFilename("Linear Algebra Done Right 4e Axler Solutions.pdf"),
      {
        title: "Linear Algebra Done Right",
        edition: "4e",
        authors: ["Axler"],
        solutions: true,
      },
    );
  });

  it("reads surnames carrying an apostrophe or a hyphen", () => {
    assert.deepEqual(
      parseShelfFilename("Advanced Engineering Mathematics 10e O'Neil.pdf")
        ?.authors,
      ["O'Neil"],
    );
    assert.deepEqual(
      parseShelfFilename("Topology 2e Munkres, Smith-Jones.pdf")?.authors,
      ["Munkres", "Smith-Jones"],
    );
  });

  it("rejects everything the naming does not codify", () => {
    for (const filename of [
      "Rosen.pdf",
      "Discrete Mathematics and Its Applications 8th Rosen.pdf",
      "Rosen - Discrete Mathematics 8th ed.pdf",
      "Rosen - Discrete Mathematics.pdf",
      "Discrete Mathematics and Its Applications 8e Rosen.epub",
      "Discrete Mathematics  and Its Applications 8e Rosen.pdf",
      " Discrete Mathematics and Its Applications 8e Rosen.pdf",
      "Introduction to Algorithms 4e Cormen,Leiserson.pdf",
      "Introduction to Algorithms 4e Cormen, Thomas H. Leiserson.pdf",
      "Concrete Mathematics Graham, .pdf",
      "Analysis 2 Tao.pdf",
      "Solutions.pdf",
      ".pdf",
    ]) {
      assert.equal(
        parseShelfFilename(filename),
        undefined,
        `Expected ${filename} to be unparseable.`,
      );
    }
  });
});
