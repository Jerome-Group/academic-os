import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateCurationRegister } from "../../src/conformance/index.js";
import { recordFindingEvidence } from "../support/rule-evidence.js";

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
    const version3 = validateCurationRegister(line({ schema_version: 3 }));

    assert.equal(version1.status, "fail");
    assert.match(
      version1.evidence,
      /Line 1 decision is not one of curated, source-only, requires-decision\./u,
    );
    assert.equal(version3.status, "fail");
    assert.match(version3.evidence, /supported versions are 1 and 2/u);
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
});
