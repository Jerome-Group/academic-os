import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAINTENANCE_DOMAINS,
  readModulePassOutcome,
} from "../../src/routine/index.js";
import { syntheticMaintenanceCoverage } from "../fixtures/maintenance-coverage.js";

const maintenance = syntheticMaintenanceCoverage();

const emptyMorning = JSON.stringify({
  maintenance,
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
    maintenance,
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
        maintenance,
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

  it("keeps completed actions when another bucket is not an array", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        maintenance,
        curated: [{ item: "source/handout.pdf", destination: "placed.pdf" }],
        rederived: [],
        superseded: [],
        withdrawn: [],
        parked: [],
        docWrites: [],
        failures: [],
        noted: "not an array",
      }),
    );

    assert.deepEqual(outcome.curated, [
      { item: "source/handout.pdf", destination: "placed.pdf" },
    ]);
    assert.deepEqual(outcome.noted, []);
    assert.deepEqual(outcome.failures, [
      {
        code: "unreadable-bucket",
        message:
          "The session result's noted must be an array. It was dropped, and the rest of the pass stands.",
      },
    ]);
  });

  it("reads maintenance coverage and the existing eight buckets", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        maintenance,
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
        maintenance,
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

  it("reads a quiet morning with all daily maintenance domains", () => {
    assert.deepEqual(readModulePassOutcome(emptyMorning), {
      maintenance,
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

  // Invalid JSON and a non-object top level have no bucket to salvage.
  it("refuses a result it cannot read as the reported shape", () => {
    assert.throws(() => readModulePassOutcome("{"), /not valid JSON/u);
    assert.throws(
      () => readModulePassOutcome(JSON.stringify([])),
      /result must be a JSON object/u,
    );
  });

  // An entry costs only itself, whichever bucket it sits in.
  it("drops an unreadable entry from any bucket rather than the pass", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        maintenance,
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

  it("salvages all eight old buckets but fails missing maintenance coverage", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        curated: [],
        rederived: [],
        superseded: [],
        withdrawn: [],
        parked: [],
        docWrites: [],
        failures: [],
        noted: [],
      }),
    );

    assert.deepEqual(outcome.maintenance, []);
    assert.equal(outcome.failures[0]?.code, "incomplete-maintenance-coverage");
  });

  it("reports omitted and duplicate maintenance domains", () => {
    const outcome = readModulePassOutcome(
      JSON.stringify({
        maintenance: [maintenance[0], maintenance[0], ...maintenance.slice(2)],
        curated: [],
        rederived: [],
        superseded: [],
        withdrawn: [],
        parked: [],
        docWrites: [],
        failures: [],
        noted: [],
      }),
    );

    assert.deepEqual(
      outcome.failures.map(({ code }) => code),
      ["duplicate-maintenance-domain", "incomplete-maintenance-coverage"],
    );
    assert.match(
      outcome.failures[1]?.message ?? "",
      new RegExp(MAINTENANCE_DOMAINS[1].id, "u"),
    );
  });

  it("drops maintenance evidence containing a blank line and reports the gap", () => {
    const invalid = maintenance.map((entry) =>
      entry.domain === "learning-sources"
        ? { ...entry, evidence: [" "] }
        : { ...entry },
    );
    const outcome = readModulePassOutcome(
      JSON.stringify({
        maintenance: invalid,
        curated: [],
        rederived: [],
        superseded: [],
        withdrawn: [],
        parked: [],
        docWrites: [],
        failures: [],
        noted: [],
      }),
    );

    assert.deepEqual(
      outcome.failures.map(({ code }) => code),
      ["invalid-maintenance-entry", "incomplete-maintenance-coverage"],
    );
    assert.match(outcome.failures[0]?.message ?? "", /non-blank strings/u);
  });
});
