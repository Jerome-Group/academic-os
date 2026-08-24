import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

// The arrival walk is a procedure an agent follows, not code this repository runs, so the pinned
// text is where MF-ROOT-003's exemption is either held or lost. #179 is what losing it costs: one
// pass parked 70 mount artifacts in a single module, and a park nobody can clear never ends.
const walkDocuments = [
  "seed-templates/docs/00 Structure and Naming.template.md",
  "seed-templates/docs/10 Curation Procedure.template.md",
];

const curationProcedure = walkDocuments[1] ?? "";

// Both documents wrap at a fixed width, so either phrase can arrive folded across a line break.
const dotNamedFile = /dot-named\s+file/u;
const finderIcon = /zero-byte\s+`Icon\\r`/u;

describe("the seeded documents an arrival walk follows", () => {
  it("names both kinds of mount artifact", async () => {
    for (const path of walkDocuments) {
      const text = await readFile(path, "utf8");
      assert.match(text, dotNamedFile, path);
      assert.match(text, finderIcon, path);
    }
  });

  // The absolute the exemption has to survive: an unqualified promise of a line per file reads as
  // an instruction to decide the furniture, whatever a paragraph above it said.
  it("owes a register line to an item rather than to every file the mirror holds", async () => {
    assert.equal(
      /every file/iu.test(await readFile(curationProcedure, "utf8")),
      false,
    );
  });
});
