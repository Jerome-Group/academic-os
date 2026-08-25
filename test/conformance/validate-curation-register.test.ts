import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateCurationRegister } from "../../src/conformance/index.js";
import {
  recordBehaviorEvidence,
  recordFindingEvidence,
} from "../support/rule-evidence.js";

function line(overrides: Record<string, unknown>): string {
  return `${JSON.stringify({
    schema_version: 2,
    source_id: "Lectures/Graph Theory/slides.pdf",
    integration: "NTULearn",
    role: "lecture",
    source_path: "03 Lectures/03 Graph Theory/slides.pdf",
    decision: "source-only",
    evidence: "Follows the standing precedent for lecture slides.",
    timestamp: "2026-08-17T06:04:11Z",
    ...overrides,
  })}\n`;
}

const version1Curated = line({
  schema_version: 1,
  decision: "curated",
  destination:
    "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_03_Graph_Theory.pdf",
});
function withdrawn(overrides: Record<string, unknown> = {}): string {
  return line({
    schema_version: 3,
    decision: "withdrawn",
    evidence: "The source has left the mirror; the placed copy stays.",
    ...overrides,
  });
}

const rederived = line({
  decision: "rederived",
  derived: ["CONTEXT.md", "docs/adr/0001-lecture-slides-are-source-only.md"],
});

describe("validateCurationRegister", () => {
  it("accepts version 1 history beside a well-formed rederived line [MF-CURATION-001]", () => {
    const mixed = validateCurationRegister(`${version1Curated}${rederived}`);

    assert.equal(mixed.status, "pass");
    assert.match(mixed.evidence, /contains 2 structurally valid events/u);
    recordFindingEvidence([mixed], "MF-CURATION-001");
  });

  it("keeps rederived out of version 1 and off an unsupported version", () => {
    const version1 = validateCurationRegister(
      line({
        schema_version: 1,
        decision: "rederived",
        derived: ["CONTEXT.md"],
      }),
    );
    const version4 = validateCurationRegister(line({ schema_version: 4 }));

    assert.equal(version1.status, "fail");
    assert.match(
      version1.evidence,
      /Line 1 decision is not one of curated, source-only, requires-decision\./u,
    );
    assert.equal(version4.status, "fail");
    assert.match(version4.evidence, /supported versions are 1, 2 and 3/u);
  });

  it("requires a rederived line to name the artifacts the content reached", () => {
    const missing = validateCurationRegister(line({ decision: "rederived" }));
    const empty = validateCurationRegister(
      line({ decision: "rederived", derived: [] }),
    );
    const escaping = validateCurationRegister(
      line({ decision: "rederived", derived: ["../MH8888/CONTEXT.md"] }),
    );

    for (const finding of [missing, empty, escaping]) {
      assert.equal(finding.status, "fail");
    }
    assert.match(
      missing.evidence,
      /Line 1 rederived decision requires a non-empty derived list/u,
    );
    assert.match(empty.evidence, /requires a non-empty derived list/u);
    assert.match(escaping.evidence, /must be module-relative/u);
  });

  it("carries withdrawn at version 3 and keeps it out of version 2", () => {
    const version3 = validateCurationRegister(withdrawn());
    const version2 = validateCurationRegister(line({ decision: "withdrawn" }));

    assert.equal(version3.status, "pass");
    assert.equal(version2.status, "fail");
    assert.match(
      version2.evidence,
      /Line 1 decision is not one of curated, source-only, requires-decision, rederived\./u,
    );
  });

  // A withdrawal is a decision about the source alone. A line that named a destination, named
  // derived artifacts, or superseded the line that placed the copy would read as an instruction to
  // move or forget that copy, which is the one thing MF-CURATION-002 promises never happens.
  it("keeps a withdrawn line saying nothing about the copy the item placed", () => {
    const placing = validateCurationRegister(
      withdrawn({
        destination: "10 Learning Materials/10 Lecture Materials/slides.pdf",
      }),
    );
    const deriving = validateCurationRegister(
      withdrawn({ derived: ["CONTEXT.md"] }),
    );
    const superseding = validateCurationRegister(
      withdrawn({ supersedes: "Lectures/Graph Theory/slides.pdf" }),
    );

    assert.match(
      placing.evidence,
      /destination is allowed only for curated decisions/u,
    );
    assert.match(
      deriving.evidence,
      /derived is allowed only for rederived decisions/u,
    );
    assert.match(
      superseding.evidence,
      /Line 1 withdrawn decision supersedes nothing: the line that placed the copy stays the record of where the item went\./u,
    );
    for (const finding of [placing, deriving, superseding]) {
      assert.equal(finding.status, "fail");
    }
  });

  it("keeps a destination and a derived list on their own decisions", () => {
    const both = validateCurationRegister(
      line({
        decision: "rederived",
        derived: ["CONTEXT.md"],
        destination: "10 Learning Materials/10 Lecture Materials/slides.pdf",
      }),
    );
    const curatedDerived = validateCurationRegister(
      line({
        decision: "curated",
        destination: "10 Learning Materials/10 Lecture Materials/slides.pdf",
        derived: ["CONTEXT.md"],
      }),
    );

    assert.equal(both.status, "fail");
    assert.match(
      both.evidence,
      /destination is allowed only for curated decisions/u,
    );
    assert.equal(curatedDerived.status, "fail");
    assert.match(
      curatedDerived.evidence,
      /derived is allowed only for rederived decisions/u,
    );
  });

  it("carries a clean copy and its annotated copy as two standing lines [MF-CURATION-003]", () => {
    const clean = line({
      source_id:
        "Lecture Slides/Teaching Week 1/Teaching Week 1 Lecture Slides.pdf",
      decision: "curated",
      destination:
        "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_01.pdf",
    });
    const annotated = line({
      source_id:
        "Lecture Slides/Teaching Week 1/Teaching Week 1 Lecture Slides (Annotated).pdf",
      decision: "curated",
      destination:
        "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_01_Annotated.pdf",
    });

    const pair = validateCurationRegister(`${clean}${annotated}`);

    assert.equal(pair.status, "pass");
    recordBehaviorEvidence("MF-CURATION-003", () => {
      assert.match(pair.evidence, /contains 2 structurally valid events/u);
    });
  });

  it("carries a reissue as the newer line curated and the earlier source-only [MF-CURATION-004]", () => {
    const earlier = line({
      source_id: "Tutorial Materials/Tutorial 2/Tutorial 2 Student Slides.pdf",
      decision: "source-only",
      evidence: "Superseded by the later issue, which took the curated name.",
    });
    const newer = line({
      source_id:
        "Tutorial Materials/Tutorial 2/Tutorial 2 Student Slides_19AUG2026.pdf",
      decision: "curated",
      destination: "20 Tutorials/MH2100_Tutorial_02_Questions.pdf",
    });

    const reissue = validateCurationRegister(`${earlier}${newer}`);

    assert.equal(reissue.status, "pass");
    recordBehaviorEvidence("MF-CURATION-004", () => {
      // The curated name carries no release date; the source's own date stays in the line.
      assert.equal(reissue.evidence.includes("19AUG2026"), false);
    });
  });
});
