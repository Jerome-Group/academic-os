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
  it("routes an explicit materialized folder without seeding or implicit personal discovery", async () => {
    const skill = await readFile("skills/learn/SKILL.md", "utf8");
    assert.match(skill, /When the Owner supplies an absolute folder path/u);
    assert.match(
      skill,
      /every required file in step 2 are materialized and readable/u,
    );
    assert.match(
      skill,
      /never create them or silently choose a different folder/u,
    );
    assert.match(skill, /Otherwise use the module-code search below/u);
    assert.match(skill, /A folder path must be absolute/u);
    assert.match(skill, /For either branch, say the resolved folder once/u);
  });

  it("reads no configuration of the system that seeded the folders", async () => {
    assert.equal(systemConfiguration.test(await readSkillText()), false);
  });

  it("names no compile invocation", async () => {
    assert.equal(compileInvocation.test(await readSkillText()), false);
  });

  it("delegates continuation and record interpretation to the live procedure", async () => {
    const skill = await readFile("skills/learn/SKILL.md", "utf8");
    assert.match(
      skill,
      /Resolve an activity target named in the invocation first/u,
    );
    assert.match(skill, /1\. Resolve the activity and target/u);
    assert.match(skill, /That step owns target order,/u);
    assert.doesNotMatch(
      skill,
      /earliest target|compare `target` plus `status`/u,
    );
  });

  it("reads the optional module preference overlay after shared preferences", async () => {
    const skill = await readFile("skills/learn/SKILL.md", "utf8");

    assert.match(skill, /70 Learning\/preferences\.local\.md/u);
  });

  it("delegates final modes and exact review closeout to the pinned procedure", async () => {
    const [skill, procedure] = await Promise.all([
      readFile("skills/learn/SKILL.md", "utf8"),
      readFile("seed-templates/docs/20 Teaching Procedure.template.md", "utf8"),
    ]);
    assert.match(
      skill,
      /follow the live procedure's \*\*Past finals\*\* route/u,
    );
    assert.match(
      procedure,
      /defaults to a full attempt under the tutorial pattern/u,
    );
    assert.match(procedure, /30-minute Final Review/u);
    assert.match(procedure, /\*\*Generated walkthrough\*\*/u);
    assert.match(
      procedure,
      /needs no submitted script,\s+mark, or graded feedback/u,
    );
    assert.match(
      procedure,
      /explicitly finishes the review[\s\S]+action=complete-review[\s\S]+selected `task_id`/u,
    );
  });

  it("prepares and opens the complete Final Review before discussing any question", async () => {
    const procedure = await readFile(
      "seed-templates/docs/20 Teaching Procedure.template.md",
      "utf8",
    );
    const prepare = procedure.indexOf("### Prepare and open the Final Review");
    const discuss = procedure.indexOf(
      "### Discuss and record the Final Review",
    );
    const closeout = procedure.indexOf("action=complete-review", discuss);
    assert.ok(prepare >= 0 && discuss > prepare && closeout > discuss);
    const preparation = procedure.slice(prepare, discuss);
    const discussion = procedure.slice(discuss, closeout);
    assert.match(
      preparation,
      /tutorial-solution-writeup\.tex.*every question and\s+subpart/su,
    );
    assert.match(preparation, /tutorial-concepts-consolidation\.tex/u);
    assert.match(
      preparation,
      /Verify both pairs[\s\S]*Open the final questions PDF, available official solutions PDFs\s+and generated Solutions and Concepts PDFs together in the current chat/u,
    );
    assert.match(preparation, /open_in_codex[\s\S]*check that each opened/u);
    assert.match(discussion, /once preparation and opening are complete/u);
    assert.match(discussion, /exact step needing more explanation/u);
    assert.match(discussion, /Preparation alone carries no\s+review coverage/u);
  });

  it("feeds question-level Final Review observations into cheatsheet selection", async () => {
    const [teaching, cheatsheet] = await Promise.all([
      readFile("seed-templates/docs/20 Teaching Procedure.template.md", "utf8"),
      readFile(
        "seed-templates/docs/40 Cheatsheet Procedure.template.md",
        "utf8",
      ),
    ]);
    assert.match(
      teaching,
      /For discussed subparts, record[\s\S]*generated artifact locator/u,
    );
    assert.match(
      teaching,
      /would help the cheatsheet, with its source locator and reason/u,
    );
    assert.match(
      cheatsheet,
      /mode: final-review[\s\S]*unresolved steps and candidate sheet items/u,
    );
    assert.match(cheatsheet, /Check the mathematics against the issued paper/u);
    assert.match(
      cheatsheet,
      /unaided\s+success only when the record shows it/u,
    );
  });

  it("applies the instructor's worked-solution standard to Final Review and other activities", async () => {
    const procedure = await readFile(
      "seed-templates/docs/20 Teaching Procedure.template.md",
      "utf8",
    );
    assert.match(
      procedure,
      /Apply the\s+\*\*Worked-solution standard\*\* from step 3 to every question/u,
    );
    const standard = procedure.split("#### Worked-solution standard")[1];
    assert.ok(standard);
    assert.match(standard, /worked solutions throughout the Module/u);
    assert.match(
      standard,
      /across\s+the Source Map, including multiple units/u,
    );
    assert.match(standard, /issued\s+marking scheme or official solution/u);
    assert.match(
      standard,
      /When official guidance is absent or compressed, use the relevant\s+lecture notes and instructor worked examples/u,
    );
    assert.match(
      standard,
      /notation, hypotheses and proof conventions\. Justify key inferences/u,
    );
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
