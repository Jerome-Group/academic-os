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
  noted: [],
});

describe("reading a module pass's result", () => {
  // One module's shape on 2026-08-25, with module-neutral paths: a complete pass whose last note
  // carried an empty string. The whole outcome was discarded and the morning reported the module
  // idle, while its Module Profile and register had already been rewritten on the mount.
  const passEndingInABadNote = JSON.stringify({
    curated: [],
    rederived: [
      {
        item: "Last synced.md",
        derived: ["00 Module Admin/00 Module Profile.md"],
      },
    ],
    superseded: [{ item: "Last synced.md", destination: null }],
    withdrawn: [],
    parked: [],
    docWrites: [
      {
        file: "00 Module Admin/00 Module Profile.md",
        summary: "Updated mirror sync status.",
      },
    ],
    failures: [],
    noted: [
      {
        item: "03 NoteOnly.pdf",
        note: "Standing divergence against the rebuilt copies.",
      },
      {
        item: "04 Full Solution.pdf",
        note: "Existing chapter copies remain byte-divergent.",
      },
      { item: "prior-run identity context", note: "" },
    ],
  });

  it("keeps every readable entry when one is unreadable", () => {
    const outcome = readModulePassOutcome(passEndingInABadNote);

    assert.equal(outcome.rederived.length, 1);
    assert.equal(outcome.superseded.length, 1);
    assert.equal(outcome.docWrites.length, 1);
    assert.deepEqual(
      outcome.noted.map((entry) => entry.item),
      ["03 NoteOnly.pdf", "04 Full Solution.pdf"],
    );
  });

  it("names the dropped entry's bucket and what was wrong with it", () => {
    const outcome = readModulePassOutcome(passEndingInABadNote);

    assert.equal(outcome.failures.length, 1);
    assert.equal(outcome.failures[0]?.code, "unreadable-entry");
    assert.match(
      outcome.failures[0]?.message ?? "",
      /A noted entry's note must be a non-empty string\. It was dropped, and the rest of the pass stands\./u,
    );
  });

  it("keeps the session's own failures beside the dropped ones", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        curated: [],
        rederived: [],
        superseded: [],
        withdrawn: [],
        parked: [],
        docWrites: [],
        failures: [
          { code: "importer-unread", message: "A root would not read." },
        ],
        noted: [{ item: "an item", note: "" }],
      }),
    );

    assert.deepEqual(
      outcome.failures.map((entry) => entry.code),
      ["importer-unread", "unreadable-entry"],
    );
  });

  // Structural breakage leaves nothing to salvage, so it still fails the pass whole.
  it("fails the pass when a bucket is not an array", () => {
    assert.throws(() =>
      readModulePassOutcome(
        JSON.stringify({
          curated: [],
          rederived: [],
          superseded: [],
          withdrawn: [],
          parked: [],
          docWrites: [],
          failures: [],
          noted: "not an array",
        }),
      ),
    );
  });

  it("reads the eight buckets a session reports", () => {
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
        noted: [
          {
            item: "source/worked-handout.pdf",
            note: "The placed copy has diverged from its source and holds its ground.",
          },
        ],
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
    assert.deepEqual(outcome.noted, [
      {
        item: "source/worked-handout.pdf",
        note: "The placed copy has diverged from its source and holds its ground.",
      },
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
        noted: [],
      }),
    );

    assert.deepEqual(outcome.superseded, [{ item: "source/notice.html" }]);
  });

  it("reads a quiet morning as eight empty buckets", () => {
    assert.deepEqual(readModulePassOutcome(emptyMorning), {
      curated: [],
      rederived: [],
      superseded: [],
      withdrawn: [],
      parked: [],
      docWrites: [],
      failures: [],
      noted: [],
    });
  });

  // Structural breakage leaves nothing to salvage: no JSON, or a bucket that is not a list.
  it("refuses a result it cannot read as the reported shape", () => {
    assert.throws(() => readModulePassOutcome("{"), /not valid JSON/u);
    assert.throws(
      () => readModulePassOutcome(JSON.stringify({ curated: [] })),
      /rederived must be an array/u,
    );
  });

  // An entry costs only itself, whichever bucket it sits in.
  it("drops an unreadable entry from any bucket rather than the pass", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        curated: [
          { item: "source/handout.pdf" },
          {
            item: "source/good.pdf",
            destination: "10 Learning Materials/10 Lecture Materials/good.pdf",
          },
        ],
        rederived: [],
        superseded: [],
        withdrawn: [],
        parked: [],
        docWrites: [],
        failures: [],
        noted: [{ item: "source/worked-handout.pdf", note: "" }],
      }),
    );

    assert.deepEqual(
      outcome.curated.map((entry) => entry.item),
      ["source/good.pdf"],
    );
    assert.equal(outcome.noted.length, 0);
    assert.deepEqual(
      outcome.failures.map((entry) => entry.code),
      ["unreadable-entry", "unreadable-entry"],
    );
    assert.match(
      outcome.failures[0]?.message ?? "",
      /destination must be a non-empty string/u,
    );
    assert.match(
      outcome.failures[1]?.message ?? "",
      /note must be a non-empty string/u,
    );
  });
});
