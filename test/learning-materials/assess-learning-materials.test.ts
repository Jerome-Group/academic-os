import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Inventory } from "../../src/conformance/index.js";
import { assessLearningMaterials } from "../../src/learning-materials/index.js";

const sourceMap = `units:
  Week 02:
    topics: [Limits, Continuity]
    teaching_weeks: [2]
    lectures:
      - 10 Learning Materials/10 Lecture Materials/MH2100_Lecture_02.pdf
      - 10 Learning Materials/10 Lecture Materials/MH2100_Broken_Link.pdf
    textbook:
      - 10 Learning Materials/20 Textbook Chapters/MH2100_Chapter_02.pdf
    tutorials:
      - block: Block A
        exercises: Exercises 1-2
        sources:
          - file: 20 Tutorials/MH2100_Tutorial_02_Questions.pdf
            locator: questions 1-2
            role: questions
          - file: 20 Tutorials/MH2100_Tutorial_02_Solutions.pdf
            locator: solutions 1-2
            role: solutions
            missing: [Exercise 2]
    supplementary_materials:
      - 10 Learning Materials/10 Lecture Materials/MH2100_Recap.pdf
    past_papers: []
    practice_tests: []
    historical_reference: []
  Week 03:
    topics: [Derivatives]
    lectures: []
    textbook: []
    tutorials: []
`;

const presentPaths = [
  "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_02.pdf",
  "20 Tutorials/MH2100_Tutorial_02_Questions.pdf",
  "20 Tutorials/MH2100_Tutorial_02_Solutions.pdf",
  "10 Learning Materials/10 Lecture Materials/MH2100_Recap.pdf",
];

function inventory(completeness: "complete" | "partial"): Inventory {
  return {
    moduleCode: "MH2100",
    entries: [
      ...presentPaths.map((path) => ({ path, kind: "file" as const })),
      {
        path: "10 Learning Materials/20 Textbook Chapters/MH2100_Chapter_02.pdf",
        kind: "directory" as const,
      },
    ],
    provenance: {
      source: "synthetic",
      target: "fixture",
      completeness,
      diagnostics:
        completeness === "complete"
          ? []
          : [
              {
                kind: "pagination-failure",
                severity: "error",
                evidence: "later inventory pages were unavailable",
              },
            ],
      excludedTrashedItems: 0,
    },
  };
}

describe("learning-material availability", () => {
  it("preserves unit order, typed tutorial evidence, exact gaps, and optional materials", () => {
    const assessed = assessLearningMaterials(sourceMap, inventory("complete"));

    assert.equal(assessed.outcome, "gaps");
    assert.deepEqual(
      assessed.units.map(({ unit, topics, status }) => ({
        unit,
        topics,
        status,
      })),
      [
        {
          unit: "Week 02",
          topics: ["Limits", "Continuity"],
          status: "gaps",
        },
        { unit: "Week 03", topics: ["Derivatives"], status: "empty" },
      ],
    );
    assert.deepEqual(assessed.missingFiles, [
      "10 Learning Materials/10 Lecture Materials/MH2100_Broken_Link.pdf",
    ]);
    assert.deepEqual(assessed.nonFiles, [
      "10 Learning Materials/20 Textbook Chapters/MH2100_Chapter_02.pdf",
    ]);
    assert.deepEqual(assessed.emptyUnits, ["Week 03"]);
    assert.deepEqual(assessed.declaredTutorialGaps, [
      {
        unit: "Week 02",
        block: "Block A",
        file: "20 Tutorials/MH2100_Tutorial_02_Solutions.pdf",
        role: "solutions",
        missing: ["Exercise 2"],
      },
    ]);
    const block = assessed.units[0]?.tutorials[0];
    assert.equal(block?.kind, "block");
    if (block?.kind === "block") {
      assert.equal(block.exercises, "Exercises 1-2");
      assert.equal(block.sources[1]?.availability, "available");
      assert.deepEqual(block.sources[1]?.declaredMissing, ["Exercise 2"]);
    }
    assert.deepEqual(
      assessed.units[0]?.supplementaryMaterials.map(
        ({ file, availability }) => ({ file, availability }),
      ),
      [
        {
          file: "10 Learning Materials/10 Lecture Materials/MH2100_Recap.pdf",
          availability: "available",
        },
      ],
    );
    assert.doesNotMatch(
      JSON.stringify(assessed),
      /mastery|completed|recommendedStudyOrder/u,
    );
  });

  it("calls an absent reference missing only when inventory is complete", () => {
    const complete = assessLearningMaterials(sourceMap, inventory("complete"));
    const partial = assessLearningMaterials(sourceMap, inventory("partial"));

    assert.equal(complete.units[0]?.lectures[1]?.availability, "missing");
    assert.equal(partial.outcome, "incomplete");
    assert.equal(partial.units[0]?.lectures[1]?.availability, "unavailable");
    assert.deepEqual(partial.missingFiles, []);
    assert.deepEqual(partial.unavailableFiles, [
      "10 Learning Materials/10 Lecture Materials/MH2100_Broken_Link.pdf",
    ]);
  });

  it("does not infer absence when inventory provenance is unavailable", () => {
    const withoutProvenance = inventory("complete");
    delete withoutProvenance.provenance;

    const assessed = assessLearningMaterials(sourceMap, withoutProvenance);

    assert.equal(assessed.inventoryCompleteness, "partial");
    assert.equal(assessed.outcome, "incomplete");
    assert.deepEqual(assessed.missingFiles, []);
    assert.deepEqual(assessed.unavailableFiles, [
      "10 Learning Materials/10 Lecture Materials/MH2100_Broken_Link.pdf",
    ]);
  });

  it("reports invalid maps and an empty valid map without inventing units", () => {
    const invalid = assessLearningMaterials(
      "units: [\n",
      inventory("complete"),
    );
    const empty = assessLearningMaterials("units: {}\n", inventory("complete"));

    assert.equal(invalid.outcome, "invalid");
    assert.match(invalid.problems[0] ?? "", /YAML parser reported/u);
    assert.equal(empty.outcome, "gaps");
    assert.equal(empty.noUnits, true);
    assert.deepEqual(empty.units, []);
  });

  it("keeps YAML unit order when a unit key looks numeric", () => {
    const assessed = assessLearningMaterials(
      `units:
  Week 02:
    topics: []
    lectures: []
    textbook: []
    tutorials: []
  1:
    topics: []
    lectures: []
    textbook: []
    tutorials: []
`,
      inventory("complete"),
    );

    assert.deepEqual(
      assessed.units.map(({ unit }) => unit),
      ["Week 02", "1"],
    );
  });
});
