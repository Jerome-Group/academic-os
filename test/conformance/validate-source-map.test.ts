import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateSourceMap } from "../../src/conformance/index.js";
import { seededSourceMap } from "../fixtures/learning-workspace.js";
import { recordFindingEvidence } from "../support/rule-evidence.js";

const populated = `units:
  Unit One:
    topics:
      - Partial derivatives
    lectures:
      - 10 Learning Materials/10 Lecture Materials/MH2100_Partial_Derivatives.pdf
    textbook:
      - 10 Learning Materials/20 Textbook Chapters/MH2100_Stewart_Chapter_14.pdf
    tutorials:
      - 20 Tutorials/MH2100_Sheet_One.pdf
`;

describe("validateSourceMap", () => {
  it("accepts the seeded empty map and a populated one [MF-LEARNING-002]", () => {
    const seeded = validateSourceMap(seededSourceMap);
    const declared = validateSourceMap(populated);

    assert.equal(seeded.status, "pass");
    assert.match(seeded.evidence, /declares 0 Lecture-units/u);
    assert.equal(declared.status, "pass");
    assert.match(declared.evidence, /declares 1 Lecture-unit\b/u);
    recordFindingEvidence([seeded, declared], "MF-LEARNING-002");
  });

  it("accepts strict tutorial blocks without flattening their source evidence", () => {
    const structured = `units:
  Unit One:
    topics: [Generic topic]
    lectures: []
    textbook: []
    tutorials:
      - block: Block A
        exercises: Exercises 1-2
        sources:
          - file: 20 Tutorials/Generic Questions.pdf
            locator: pages 1-2
            role: questions
          - file: 20 Tutorials/Generic Solutions.pdf
            locator: solutions 1-2
            role: solutions
            missing: [Exercise 2]
`;

    assert.equal(validateSourceMap(structured).status, "pass");
  });

  it("accepts the typed current unit extensions and rejects malformed values", () => {
    const extended = populated.replace(
      "    topics:",
      `    teaching_weeks: [1, 2]\n    supplementary_materials: [10 Learning Materials/10 Lecture Materials/Generic Recap.pdf]\n    past_papers: [30 Assessments/20 Tests/Generic Questions.pdf]\n    practice_tests: [30 Assessments/20 Tests/Generic Mock.pdf]\n    historical_reference: [90 Resources/00 Unclassified/Generic Reference.pdf]\n    topics:`,
    );
    assert.equal(validateSourceMap(extended).status, "pass");

    const malformed = validateSourceMap(
      extended
        .replace("teaching_weeks: [1, 2]", "teaching_weeks: [1, 1]")
        .replace(
          "30 Assessments/20 Tests/Generic Mock.pdf",
          "../Generic Mock.pdf",
        ),
    );
    assert.equal(malformed.status, "fail");
    assert.match(
      malformed.evidence,
      /teaching_weeks must be a non-empty sequence/u,
    );
    assert.match(
      malformed.evidence,
      /practice_tests entries must be non-empty module-relative paths/u,
    );
  });

  it("rejects malformed tutorial blocks and unknown machine fields", () => {
    const malformed = `units:
  Unit One:
    topics: []
    lectures: []
    textbook: []
    tutorials:
      - block: ''
        exercises: ''
        sources:
          - file: /external/questions.pdf
            locator: ''
            role: ''
            missing: []
            guess: true
`;

    const finding = validateSourceMap(malformed);
    assert.equal(finding.status, "fail");
    assert.match(finding.evidence, /requires a non-empty block/u);
    assert.match(finding.evidence, /requires a non-empty exercises locator/u);
    assert.match(
      finding.evidence,
      /file must be a non-empty module-relative path/u,
    );
    assert.match(finding.evidence, /unknown field "guess"/u);

    const unknownUnitField = validateSourceMap(
      populated.replace(
        "    tutorials:",
        "    inferred_mastery: true\n    tutorials:",
      ),
    );
    assert.equal(unknownUnitField.status, "fail");
    assert.match(
      unknownUnitField.evidence,
      /unknown field "inferred_mastery"/u,
    );
  });

  it("rejects misplaced target fields at the document root", () => {
    const finding = validateSourceMap("units: {}\npast_papers: [paper.pdf]\n");
    assert.equal(finding.status, "fail");
    assert.match(
      finding.evidence,
      /Source Map has unknown field "past_papers"/u,
    );
  });

  it("reports an absent, unparseable, or shapeless map", () => {
    const absent = validateSourceMap(undefined);
    const unparseable = validateSourceMap("units: [\n");
    const shapeless = validateSourceMap("lectures: []\n");

    assert.deepEqual(
      [absent, unparseable, shapeless].map(({ ruleId, status, path }) => ({
        ruleId,
        status,
        path,
      })),
      Array.from({ length: 3 }, () => ({
        ruleId: "MF-LEARNING-002",
        status: "fail",
        path: "00 Module Admin/40 Source Map.yaml",
      })),
    );
    assert.match(absent.evidence, /No readable control/u);
    assert.match(unparseable.evidence, /YAML parser reported/u);
    assert.match(shapeless.evidence, /requires a units mapping/u);
  });

  it("reports a unit missing a sequence, an empty entry, and an escaping path", () => {
    const missingSequence = validateSourceMap(
      "units:\n  Unit One:\n    topics: []\n    lectures: []\n    textbook: []\n",
    );
    const emptyEntry = validateSourceMap(
      populated.replace("      - Partial derivatives\n", "      - ''\n"),
    );
    const escaping = validateSourceMap(
      populated.replace(
        "      - 20 Tutorials/MH2100_Sheet_One.pdf\n",
        "      - ../MH8888/20 Tutorials/Sheet.pdf\n",
      ),
    );

    assert.equal(missingSequence.status, "fail");
    assert.match(
      missingSequence.evidence,
      /Unit "Unit One" requires tutorials as a sequence/u,
    );
    assert.equal(emptyEntry.status, "fail");
    assert.match(
      emptyEntry.evidence,
      /Unit "Unit One" has an empty topics entry/u,
    );
    assert.equal(escaping.status, "fail");
    assert.match(
      escaping.evidence,
      /tutorials entry 1 .* is not module-relative/u,
    );
  });
});
