import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { recordBehaviorEvidence } from "../support/rule-evidence.js";

// The pass follows the pinned procedure rather than code this repository runs, so the shipped text
// is the whole of this rule. #198 is what its absence cost: one source cut into a chapter apiece was
// filed as a curated line per chapter, and every morning compared each chapter against the whole
// document and reported a divergence the work itself had put there.
const curationProcedure =
  "seed-templates/docs/10 Curation Procedure.template.md";
const contract = "docs/module-folder-contract.md";

async function procedure(): Promise<string> {
  return readFile(curationProcedure, "utf8");
}

describe("the seeded procedure's split source", () => {
  it("routes one source worked into several artifacts to a single rederived line", async () => {
    const text = await procedure();

    assert.match(text, /## One source, many artifacts/u);
    assert.match(
      text,
      /\*\*One source worked into several artifacts is one `rederived` decision\.\*\*/u,
    );
    assert.match(
      text,
      /It names every artifact\s+the work produced in `derived`/u,
    );
  });

  // MF-CURATION-003 and MF-CURATION-004 are the neighbouring shapes, and the headings are what keep
  // them apart: two sources building one or two artifacts is the other direction entirely.
  it("distinguishes it from the two sources that build one item", async () => {
    const text = await procedure();

    assert.match(
      text,
      /The section above is the other direction: there\s+two sources build one or two artifacts, and here one source builds many\./u,
    );
    assert.match(
      text,
      /\*\*A clean copy and an annotated copy are two artifacts\.\*\*/u,
    );
    assert.match(
      text,
      /\*\*Two live paths are two issues of one artifact\.\*\*/u,
    );
  });

  it("keeps a destination holding the source's own bytes curated", async () => {
    const text = await procedure();

    assert.match(
      text,
      /\*\*A whole copy among the cuts is still `curated`\.\*\*/u,
    );
    assert.match(
      text,
      /Decide per destination: what holds the source's own bytes keeps its `curated`\s+line/u,
    );
  });

  it("corrects an existing split by appending, and reports it when the Owner is away", async () => {
    const text = await procedure();

    assert.match(
      text,
      /\*\*A split already filed as many `curated` lines is corrected by appending\.\*\*/u,
    );
    assert.match(
      text,
      /every line already written stays exactly where it is as\s+the record of what was decided when/u,
    );
    assert.match(
      text,
      /With the Owner absent, report the split rather than correcting\s+it/u,
    );
  });

  // The divergence walk is what #198's loop ran through, and scoping it is what ends the loop.
  it("owes no destination comparison for a rederived line [MF-CURATION-005]", async () => {
    const text = await procedure();

    recordBehaviorEvidence("MF-CURATION-005", () => {
      assert.match(
        text,
        /The walk is over `curated` lines: a `rederived` line\s+closed its item and named what the work produced, so it owes no comparison and reports no\s+divergence\./u,
      );
    });
  });

  it("is the contract's rule before it is the procedure's", async () => {
    const text = await readFile(contract, "utf8");

    assert.match(
      text,
      /the item is one `rederived` decision naming every\s+artifact in `derived`, and not a `curated` line per artifact/u,
    );
    assert.match(
      text,
      /MF-CURATION-002's standing-divergence walk reads `curated` lines, so a `rederived` item\s+is not reported as diverging/u,
    );
    assert.match(
      text,
      /A destination holding the source's own bytes is a copy and its `curated` line\s+stands beside the `rederived` one\./u,
    );
  });
});
