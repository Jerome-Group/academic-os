import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { recordBehaviorEvidence } from "../support/rule-evidence.js";

// No code in this repository performs the arrival walk: the unattended pass reads the module's own
// pinned copy of this procedure and decides from it. The shipped text is therefore the whole of the
// rule, and what a second walk over a rewritten sync stamp does is decided here — #199 is the
// thirty-five register lines the absent rule cost across six modules in two weeks.
const curationProcedure =
  "seed-templates/docs/10 Curation Procedure.template.md";
const contract = "docs/module-folder-contract.md";

async function procedure(): Promise<string> {
  return readFile(curationProcedure, "utf8");
}

describe("the seeded procedure's re-reached decision", () => {
  it("appends nothing when the second walk decides source-only again", async () => {
    const text = await procedure();

    assert.match(
      text,
      /\*\*A `source-only` decision re-reached takes no line\.\*\*/u,
    );
    assert.match(
      text,
      /an update\s+arrival you decide `source-only` again is finished when you have decided it/u,
    );
  });

  // The join table is where the walk is routed, and its old row sent every update arrival to a
  // superseding line. A rule the table contradicts is a rule the pass meets second.
  it("routes an update arrival by whether the decision changed", async () => {
    const text = await procedure();

    assert.match(
      text,
      /\| Path known, checksum new \| An \*\*update arrival\*\* \| Decide it again; a changed decision supersedes, a re-reached one takes no line \|/u,
    );
    assert.doesNotMatch(
      text,
      /An \*\*update arrival\*\* \| Decide it again, superseding the earlier line/u,
    );
  });

  // Scoping by the headline rather than by a carve-out is what closes the gap: a blanket "a decision
  // re-reached takes no line" reads as silencing a rederived item whose artifacts were worked again.
  it("keeps every decision but source-only appending", async () => {
    const text = await procedure();

    assert.match(
      text,
      /Every other decision still appends, because each of them records something the arrival changed/u,
    );
    for (const clause of [
      /a\s+`curated` line's copy was replaced/u,
      /a `rederived` line's artifacts were worked again/u,
      /a\s+`requires-decision` line carries the evidence this arrival gave the Owner/u,
    ]) {
      assert.match(text, clause);
    }
  });

  // A morning that decided the stamp and recorded nothing must also say nothing, or the silence is
  // traded for a line in a report bucket instead of one in the register.
  it("reports nothing about a stamp it decided and did not record", async () => {
    const text = await procedure();

    assert.match(
      text,
      /Decide it, record nothing, and\s+report nothing: nothing happened that the Owner is owed\./u,
    );
  });

  // The precedent one live module set — rederiving the stamp into its Profile — is displaced by a
  // rule rather than argued with at 06:00, because precedent is the unattended pass's only resolver.
  it("keeps the sync stamp source-only and out of the module docs", async () => {
    const text = await procedure();

    assert.match(
      text,
      /The sync stamp's content is not rederived into a module doc, however often the importer rewrites it\./u,
    );
    assert.match(
      text,
      /a Profile naming the stamp is citing it correctly, and one quoting its date is\s+carrying a value that was wrong by the following morning/u,
    );
    assert.doesNotMatch(
      text,
      /`docs\/00 Structure and Naming\.md` has the Profile cite/u,
    );
  });

  it("is the contract's rule before it is the procedure's [MF-CURATION-006]", async () => {
    const text = await readFile(contract, "utf8");

    recordBehaviorEvidence("MF-CURATION-006", () => {
      assert.match(
        text,
        /An update arrival that a walk decides `source-only` again appends no\s+register line\./u,
      );
      assert.match(
        text,
        /Every\s+other decision still appends, because each records something the arrival changed/u,
      );
      assert.match(
        text,
        /its content is not\s+rederived into a module doc, because MF-PROFILE-002 has the Profile cite that file rather than a\s+value read out of it/u,
      );
    });
  });

  // MF-IMPORTER-001's landmark is what the ticket required survive, and it is untouched.
  it("leaves the stamp citable as a landmark", async () => {
    const text = await readFile(contract, "utf8");

    assert.match(
      text,
      /Its standing line and its MF-IMPORTER-001\s+landmark are both untouched/u,
    );
    assert.match(
      text,
      /\*\*landmark\*\*, which is `Course\.md`, `Last synced\.md`, `Announcements\/` or a root itself/u,
    );
  });
});
