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
      /lists tutorials entry .*, which is not module-relative/u,
    );
  });
});
