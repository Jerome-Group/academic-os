import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

// ADR-0017 draws the `/learn` skill at no rules: the pinned Teaching Procedure keeps every one of
// them. Most of that boundary needs judgement and is held by review. The compile invocation does
// not — it is the drift the record was written about, and naming it is the one crossing a grep can
// see, which is why the record states the test in exactly this form.
const compileInvocation = /latexmk|-auxdir|-outdir/u;

// ADR-0017: the skill reads the module folders and nothing else, so a machine that syncs them can
// run it with no clone, no configuration and no credential — spec #94's story 25. A configuration
// path reappearing in its text is that promise being withdrawn.
const systemConfiguration = /academic-os\.config\.json/u;

// Both files, because the Codex manifest carries free text of its own — a short description is as
// good a place to leak a rule into as the skill body, and it is the file nobody thinks to reread.
async function readSkillText(): Promise<string> {
  const parts = await Promise.all(
    ["skills/learn/SKILL.md", "skills/learn/agents/openai.yaml"].map((path) =>
      readFile(path, "utf8"),
    ),
  );
  return parts.join("\n");
}

describe("the learn skill", () => {
  it("reads no configuration of the system that seeded the folders", async () => {
    assert.equal(systemConfiguration.test(await readSkillText()), false);
  });

  it("names no compile invocation", async () => {
    assert.equal(compileInvocation.test(await readSkillText()), false);
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
