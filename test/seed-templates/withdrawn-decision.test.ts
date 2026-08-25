import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

// The arrival walk is a procedure an agent follows rather than code this repository runs, so the
// pinned text is where a withdrawal's safety is either held or lost. #186 is what losing the
// decision cost: one standing line whose source upstream had renamed away parked identically every
// morning, because the procedure could surface a missing source and never record that it had.
const curationProcedure =
  "seed-templates/docs/10 Curation Procedure.template.md";

async function procedure(): Promise<string> {
  return readFile(curationProcedure, "utf8");
}

describe("the seeded procedure's withdrawn decision", () => {
  it("ends the join running the other way in a withdrawn line", async () => {
    const text = await procedure();

    assert.match(
      text,
      /the join running the other way, and it ends in a `withdrawn` line/u,
    );
    assert.equal(/surfaced as a discrepancy/u.test(text), false);
  });

  it("leaves the copy the item placed exactly where it is", async () => {
    const text = await procedure();

    assert.match(text, /Whatever the item already\s+placed stays exactly/u);
    assert.match(text, /a `withdrawn` line supersedes nothing/u);
  });

  // The two safeties, and the reason the decision is safe to take unattended: a mirror missing many
  // sources at once is a failed sync, and closing those items would end a module's history on it.
  it("rests a withdrawal on a completed walk and parks a mass disappearance", async () => {
    const text = await procedure();

    assert.match(text, /Withdraw only from a walk that completed/u);
    assert.match(text, /read end to end, or there is no withdrawal to write/u);
    assert.match(text, /Many standing sources gone at once is an ambiguity/u);
  });

  it("hands a source that came back to the walk as a new item", async () => {
    const text = await procedure();

    assert.match(
      text,
      /\| Standing line `withdrawn` \| The source has come back \| A new item; classify it \|/u,
    );
    assert.match(text, /classified from scratch/u);
  });

  it("writes new lines at the schema version that carries the decision", async () => {
    const text = await procedure();

    assert.match(text, /"schema_version":3/u);
    assert.match(
      text,
      /`schema_version` is 3 — the version that carries `withdrawn`/u,
    );
  });
});
