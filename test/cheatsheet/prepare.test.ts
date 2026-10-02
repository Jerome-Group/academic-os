import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { validModuleControls } from "../fixtures/module-controls.js";
import { prepareCheatsheet } from "../../src/cheatsheet/index.js";
import {
  assertCheatsheetReleaseReady,
  validateCoverageCorrespondence,
} from "../../src/cheatsheet/evidence.js";
import type { CheatsheetManifest } from "../../src/cheatsheet/types.js";

it("discovers synthetic MH2100 midterm with ordered provenance and detects changed/missing sources on repeated runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "cheatsheet-context-"));
  try {
    const admin = join(root, "00 Module Admin");
    await mkdir(admin);
    const controls = validModuleControls();
    await writeFile(
      join(admin, "10 Module Definition.yaml"),
      controls.definition ?? "",
    );
    await writeFile(
      join(admin, "00 Module Profile.md"),
      (controls.profile ?? "").replace(
        "Week 7 | NTULearn",
        "Week 7 | notice.md",
      ),
    );
    await writeFile(
      join(admin, "40 Source Map.yaml"),
      "units:\n  Unit 1:\n    topics: [Limits]\n    lectures: [lecture.md]\n    textbook: []\n    tutorials:\n      - block: A\n        exercises: Q1\n        sources:\n          - file: tutorial.md\n            locator: Q1\n            role: questions\n            missing: [official solution]\n",
    );
    await writeFile(join(root, "lecture.md"), "synthetic first source");
    await writeFile(join(root, "tutorial.md"), "synthetic question");
    const input = {
      moduleRoot: root,
      moduleCode: "MH2100",
      assessment: "midterm",
    };
    const first = await prepareCheatsheet(input);
    assert.equal(first.status, "context-discovered");
    assert.equal(first.assessments[0]?.Evidence, "notice.md");
    assert.deepEqual(
      first.candidates.map(({ path }) => path),
      ["lecture.md", "tutorial.md"],
    );
    assert.deepEqual(first.candidates[1]?.missing, ["official solution"]);
    assert.deepEqual(await prepareCheatsheet(input), first);
    await writeFile(join(root, "lecture.md"), "synthetic changed source");
    assert.notEqual(
      (await prepareCheatsheet(input)).candidates[0]?.sha256,
      first.candidates[0]?.sha256,
    );
    await rm(join(root, "tutorial.md"));
    assert.equal((await prepareCheatsheet(input)).status, "needs-choice");
    await assert.rejects(
      prepareCheatsheet({ ...input, moduleCode: "MH9999" }),
      /identity/u,
    );
    await writeFile(
      join(admin, "00 Module Profile.md"),
      "## Assessment Structure\n| Component | Weight | Timing | Evidence |\n| --- | --- | --- | --- |\n| Midterm A | unknown | Week 6 | a.md |\n| Midterm B | 20% | Week 7 | b.md |\n",
    );
    const conflict = await prepareCheatsheet(input);
    assert.match(conflict.unresolved.join(" "), /2 Profile rows/u);
    assert.match(conflict.unresolved.join(" "), /unknown/u);
    await writeFile(
      join(admin, "10 Module Definition.yaml"),
      "module: {code: MH2100, title: Synthetic}\noffering: {academic_year: 2026-2027, semester: 1}\n",
    );
    const malformed = await prepareCheatsheet(input);
    assert.equal(malformed.status, "needs-choice");
    assert.match(malformed.unresolved.join(" "), /MF-DEFINITION-001/u);
    assert.match(malformed.unresolved.join(" "), /MF-PROFILE-001/u);
    await writeFile(
      join(admin, "10 Module Definition.yaml"),
      (controls.definition ?? "").replace(
        "contract_version: 7",
        "contract_version: 6",
      ),
    );
    await writeFile(
      join(admin, "00 Module Profile.md"),
      controls.profile ?? "",
    );
    const incompatible = await prepareCheatsheet(input);
    assert.equal(incompatible.status, "needs-choice");
    assert.match(incompatible.unresolved.join(" "), /contract_version/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses invented coverage labels and locators; incomplete coverage never releases", () => {
  const manifest = {
    sources: [{ id: "source", locators: ["Q1"] }],
  } as CheatsheetManifest;
  const item = {
    id: "q1",
    sourceId: "source",
    locator: "Q1",
    topicId: "limits",
    priority: "required" as const,
    disposition: "condensed" as const,
    artifactLocator: "answer",
  };
  assert.throws(
    () =>
      validateCoverageCorrespondence(manifest, [item], "% \\label{answer}\n"),
    /missing artifact label/u,
  );
  assert.throws(
    () =>
      validateCoverageCorrespondence(
        manifest,
        [{ ...item, locator: "Q2" }],
        "\\label{answer}",
      ),
    /source locators/u,
  );
  validateCoverageCorrespondence(manifest, [item], "\\label{answer}");
  assert.throws(
    () =>
      assertCheatsheetReleaseReady({
        coverage: [{ ...item, disposition: "pending" }],
      } as Parameters<typeof assertCheatsheetReleaseReady>[0]),
    /every required/u,
  );
});
