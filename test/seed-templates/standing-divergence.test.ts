import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { recordBehaviorEvidence } from "../support/rule-evidence.js";

// The pass follows the pinned procedure rather than code this repository runs, so the shipped text
// is the whole of this rule. #192 is what its absence cost: two mornings met the same unchanged
// divergence and reported it differently, because the procedure named only the arrival beside it.
const curationProcedure =
  "seed-templates/docs/10 Curation Procedure.template.md";
const contract = "docs/module-folder-contract.md";

async function procedure(): Promise<string> {
  return readFile(curationProcedure, "utf8");
}

describe("the seeded procedure's standing divergence", () => {
  it("compares every standing curated copy, arrival or not", async () => {
    const text = await procedure();

    assert.match(text, /\*\*A standing divergence is told, not decided\.\*\*/u);
    assert.match(
      text,
      /Compare every standing `curated` line's placed copy\s+against the source it names, whether or not anything arrived/u,
    );
  });

  it("reports it without a register line [MF-CURATION-002]", async () => {
    const text = await procedure();

    recordBehaviorEvidence("MF-CURATION-002", () => {
      assert.match(
        text,
        /takes no line, because the `curated` decision that placed the copy still stands/u,
      );
      assert.match(text, /reports it in `noted`/u);
    });
  });

  // The two clauses this rule sits beside stay true and stay scoped to an arrival. A standing
  // divergence that read as either of them would park daily, which is the behaviour #187 removed.
  it("leaves both ground-holding parks scoped to an update arrival", async () => {
    const text = await procedure();

    assert.match(
      text,
      /\*\*An update arrival supersedes on one condition\.\*\*[\s\S]*?parks, and\s+the placed copy holds its ground\./u,
    );
    assert.match(
      text,
      /a placed copy that has\s+been worked on holds its ground and parks\./u,
    );
  });

  it("is the contract's rule before it is the procedure's", async () => {
    const text = await readFile(contract, "utf8");

    assert.match(
      text,
      /a source nothing has re-issued is a \*\*standing divergence\*\*, and it is\s+reported rather than decided/u,
    );
    assert.match(
      text,
      /It takes no register line: the `curated`\s+decision that placed the copy still stands/u,
    );
  });
});
