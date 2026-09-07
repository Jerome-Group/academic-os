import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseCheatsheetCoverage,
  parseCheatsheetManifest,
  planCheatsheetFit,
} from "../../src/cheatsheet/index.js";
import { recordBehaviorEvidence } from "../support/rule-evidence.js";

const digest = "a".repeat(64);
const manifest = `schema_version: 1
artifact:
  id: final-aid
  title: Final aid
  scope: Current issued syllabus
  release_tex: 10 Learning Materials/30 Personal Notes/Final Aid.tex
  release_pdf: 10 Learning Materials/30 Personal Notes/Final Aid.pdf
  support: 10 Learning Materials/30 Personal Notes/support/final-aid
authoring:
  kind: self-contained
  path: 10 Learning Materials/30 Personal Notes/Final Aid.tex
  sha256: ${digest}
constraints:
  paper: A4
  pages: {exact: 2}
  color: monochrome
  columns: 4
  body_pt: {preferred: 4.2, floor: 3.9}
sources:
  - id: issued-1
    path: NTULearn/assessment.pdf
    sha256: ${digest}
    authority: issued-current
    locators: [questions 1-4]
coverage: 10 Learning Materials/30 Personal Notes/support/final-aid/coverage.csv
release:
  tex_sha256: ${digest}
  pdf_sha256: ${digest}
  review: {status: passed, reviewed_pdf_sha256: ${digest}}
`;

describe("cheatsheet manifest and coverage", () => {
  it("parses one portable release authority and exact reviewed PDF", () => {
    const parsed = parseCheatsheetManifest(manifest);
    assert.equal(parsed.authoring.kind, "self-contained");
    assert.equal(parsed.release.review.status, "passed");
    assert.equal(parsed.constraints.bodyPt.floor, 3.9);
    recordBehaviorEvidence("MF-CHEATSHEET-002", () => {
      assert.equal(parsed.artifact.support.endsWith("support/final-aid"), true);
    });
  });

  it("rejects stale review truth and source paths outside the module", () => {
    assert.throws(
      () =>
        parseCheatsheetManifest(
          manifest.replace(
            `reviewed_pdf_sha256: ${digest}`,
            `reviewed_pdf_sha256: ${"b".repeat(64)}`,
          ),
        ),
      /exact released PDF digest/u,
    );
    assert.throws(
      () =>
        parseCheatsheetManifest(
          manifest.replace("NTULearn/assessment.pdf", "../private.pdf"),
        ),
      /module-relative path/u,
    );
  });

  it("tracks every required part and explains exclusions", () => {
    const parsed = parseCheatsheetCoverage({
      csv: `item_id,source_id,locator,topic_id,priority,disposition,artifact_locator,note
q1a,issued-1,question 1(a),TOP-A,required,condensed,Q1a,
extra,issued-1,appendix,TOP-A,extension,excluded,,outside scope
`,
      sourceIds: new Set(["issued-1"]),
    });
    assert.equal(parsed.length, 2);
    recordBehaviorEvidence("MF-CHEATSHEET-003", () => {
      assert.equal(parsed[0]?.priority, "required");
    });
    assert.throws(
      () =>
        parseCheatsheetCoverage({
          csv: `item_id,source_id,locator,topic_id,priority,disposition,artifact_locator,note
q1a,issued-1,question 1(a),TOP-A,required,excluded,,space
`,
          sourceIds: new Set(["issued-1"]),
        }),
      /required coverage item/u,
    );
  });
});

const constraints = {
  paper: "A4" as const,
  pages: { exact: 2 },
  color: "monochrome" as const,
  columns: 4,
  bodyPt: { preferred: 4.2, floor: 3.9 },
};
const baseMeasurements = {
  pages: 2,
  bodyPt: 4.2,
  overfullBoxes: 0,
  missingGlyphs: 0,
  unidentifiedContinuations: 0,
  internalVoidBaselines: 0,
  finalColumnUnusedMm: 0,
};
const item = (
  id: string,
  priority: "required" | "high" | "useful" | "extension",
  disposition: "verbatim" | "condensed" | "pending",
) => ({
  id,
  sourceId: "issued-1",
  locator: id,
  topicId: "TOP-A",
  priority,
  disposition,
  ...(disposition === "pending" ? {} : { artifactLocator: id }),
});

describe("cheatsheet fitting", () => {
  it("expands the strongest pending source when sparse", () => {
    assert.deepEqual(
      planCheatsheetFit({
        constraints,
        coverage: [
          item("extension", "extension", "pending"),
          item("high", "high", "pending"),
        ],
        measurements: { ...baseMeasurements, pages: 1 },
      }),
      {
        kind: "expand",
        itemId: "high",
        reason:
          "Use the highest-priority unused sourced item before adding original material.",
      },
    );
  });

  it("cuts lowest-priority optional content first on overflow", () => {
    const decision = planCheatsheetFit({
      constraints,
      coverage: [
        item("required", "required", "verbatim"),
        item("extra", "extension", "condensed"),
      ],
      measurements: { ...baseMeasurements, pages: 3 },
    });
    assert.deepEqual(decision, {
      kind: "compress",
      itemId: "extra",
      operation: "remove",
      reason:
        "The page limit is exceeded; change the lowest-priority included item first.",
    });
  });

  it("surfaces incompatible hard constraints for a user choice", () => {
    const compression = planCheatsheetFit({
      constraints,
      coverage: [item("required", "required", "verbatim")],
      measurements: { ...baseMeasurements, pages: 3 },
    });
    assert.deepEqual(compression, {
      kind: "compress",
      itemId: "required",
      operation: "condense",
      reason:
        "The page limit is exceeded; shorten this required item while retaining its conditions and reasoning.",
    });
    const fontStep = planCheatsheetFit({
      constraints,
      coverage: [item("required", "required", "condensed")],
      measurements: { ...baseMeasurements, pages: 3 },
    });
    assert.deepEqual(fontStep, {
      kind: "adjust-font",
      bodyPt: 4.1,
      reason:
        "Content compression is exhausted; measure the next native body size before changing a hard constraint.",
    });
    const decision = planCheatsheetFit({
      constraints,
      coverage: [item("required", "required", "condensed")],
      measurements: { ...baseMeasurements, pages: 3, bodyPt: 3.9 },
    });
    assert.equal(decision.kind, "user-choice");
    const belowFloor = planCheatsheetFit({
      constraints,
      coverage: [item("required", "required", "verbatim")],
      measurements: { ...baseMeasurements, bodyPt: 3.8 },
    });
    assert.equal(belowFloor.kind, "blocked");
    recordBehaviorEvidence("MF-CHEATSHEET-004", () => {
      assert.equal(decision.kind, "user-choice");
    });
  });

  it("blocks an unmet exact page constraint when expansion is exhausted", () => {
    assert.deepEqual(
      planCheatsheetFit({
        constraints,
        coverage: [item("required", "required", "condensed")],
        measurements: { ...baseMeasurements, pages: 1 },
      }),
      {
        kind: "blocked",
        reasons: [
          "Release has 1 pages; exactly 2 are required and no sourced expansion remains.",
        ],
      },
    );
  });
});
