import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

// ADR-0017 draws the `/learn` skill at no rules: the pinned Teaching Procedure keeps every one of
// them. Most of that boundary needs judgement and is held by review. The compile invocation does
// not — it is the drift the record was written about, and naming it is the one crossing a grep can
// see, which is why the record states the test in exactly this form.
const compileInvocation = /latexmk|-auxdir|-outdir/u;

describe("the learn skill", () => {
  it("names no compile invocation", async () => {
    const body = await readFile("skills/learn/SKILL.md", "utf8");

    assert.equal(compileInvocation.test(body), false);
  });

  // One decision, and each harness spells it in its own file, so a harness added without its
  // encoding is a skill that quietly starts firing on its own there.
  it("fires only when the Owner invokes it, in every harness it is installed into", async () => {
    const [skill, openai] = await Promise.all([
      readFile("skills/learn/SKILL.md", "utf8"),
      readFile("skills/learn/agents/openai.yaml", "utf8"),
    ]);

    assert.match(skill, /^disable-model-invocation: true$/mu);
    assert.match(openai, /^ {2}allow_implicit_invocation: false$/mu);
  });
});
