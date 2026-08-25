import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readModulePassOutcome } from "../../src/routine/index.js";

const emptyMorning = JSON.stringify({
  curated: [],
  rederived: [],
  superseded: [],
  withdrawn: [],
  parked: [],
  docWrites: [],
  failures: [],
});

describe("reading a module pass's result", () => {
  it("reads the seven buckets a session reports", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        curated: [{ item: "source/handout.pdf", destination: "placed.pdf" }],
        rederived: [{ item: "source/notice.html", derived: ["profile.md"] }],
        superseded: [{ item: "source/handout.pdf", destination: "placed.pdf" }],
        withdrawn: [
          {
            item: "source/makeup-class.md",
            evidence: "The source has left the mirror; the placed copy stays.",
          },
        ],
        parked: [
          { item: "source/odd.zip", reason: "no precedent", evidence: "cited" },
        ],
        docWrites: [{ file: "CONTEXT.md", summary: "minted a term" }],
        failures: [{ code: "read-failed", message: "the mirror went away" }],
      }),
    );

    assert.deepEqual(outcome.curated, [
      { item: "source/handout.pdf", destination: "placed.pdf" },
    ]);
    assert.deepEqual(outcome.rederived, [
      { item: "source/notice.html", derived: ["profile.md"] },
    ]);
    assert.deepEqual(outcome.withdrawn, [
      {
        item: "source/makeup-class.md",
        evidence: "The source has left the mirror; the placed copy stays.",
      },
    ]);
    assert.deepEqual(outcome.parked, [
      { item: "source/odd.zip", reason: "no precedent", evidence: "cited" },
    ]);
    assert.deepEqual(outcome.docWrites, [
      { file: "CONTEXT.md", summary: "minted a term" },
    ]);
    assert.deepEqual(outcome.failures, [
      { code: "read-failed", message: "the mirror went away" },
    ]);
  });

  it("reads a supersession that replaced a decision placing no copy", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        curated: [],
        rederived: [],
        superseded: [{ item: "source/notice.html", destination: null }],
        withdrawn: [],
        parked: [],
        docWrites: [],
        failures: [],
      }),
    );

    assert.deepEqual(outcome.superseded, [{ item: "source/notice.html" }]);
  });

  it("reads a quiet morning as seven empty buckets", () => {
    assert.deepEqual(readModulePassOutcome(emptyMorning), {
      curated: [],
      rederived: [],
      superseded: [],
      withdrawn: [],
      parked: [],
      docWrites: [],
      failures: [],
    });
  });

  it("refuses a result it cannot read as the reported shape", () => {
    assert.throws(() => readModulePassOutcome("{"), /not valid JSON/u);
    assert.throws(
      () => readModulePassOutcome(JSON.stringify({ curated: [] })),
      /rederived must be an array/u,
    );
    assert.throws(
      () =>
        readModulePassOutcome(
          JSON.stringify({
            curated: [{ item: "source/handout.pdf" }],
            rederived: [],
            superseded: [],
            withdrawn: [],
            parked: [],
            docWrites: [],
            failures: [],
          }),
        ),
      /destination must be a non-empty string/u,
    );
  });
});
