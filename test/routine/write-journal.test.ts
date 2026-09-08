import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateWriteJournal,
  type ModulePassOutcome,
} from "../../src/routine/index.js";
import { syntheticMaintenanceCoverage } from "../fixtures/maintenance-coverage.js";

describe("the mounted-write journal", () => {
  it("accepts exact adjacent pairs and requires a pair for every reported action", () => {
    const outcome = emptyOutcome();
    outcome.docWrites.push({ file: "CONTEXT.md", summary: "updated fact" });
    const journal = validateWriteJournal({
      contents: pair("write-context", "CONTEXT.md", "replace-file"),
      outcome,
      changedPaths: [],
    });

    assert.equal(journal.valid, true, JSON.stringify(journal.failures));
    assert.deepEqual(journal.completedPaths, ["CONTEXT.md"]);
  });

  it("rejects malformed, unpaired, traversing, and unjournalled action records", () => {
    const outcome = emptyOutcome();
    outcome.curated.push({
      item: "NTULearn/a.pdf",
      destination: "10 Learning Materials/a.pdf",
    });
    const journal = validateWriteJournal({
      contents: `${JSON.stringify({
        schemaVersion: 1,
        type: "intent",
        id: "bad",
        path: "../outside",
        operation: "create-file",
        plannedResult: "copy",
        proofs: {
          containment: "checked",
          deliberateTarget: "exclusive",
          materialization: "downloaded",
          freshReading: "fresh digest",
        },
      })}\n`,
      outcome,
      changedPaths: [],
    });

    assert.equal(journal.valid, false);
    assert.ok(journal.failures.length >= 2);
    assert.ok(
      journal.failures.every(({ code }) => code === "write-journal-invalid"),
    );
  });

  it("turns a refused or failed paired operation into a visible failure", () => {
    const contents = pair("refused", "CONTEXT.md", "replace-file").replace(
      '"outcome":"completed"',
      '"outcome":"refused"',
    );
    const journal = validateWriteJournal({
      contents,
      outcome: emptyOutcome(),
      changedPaths: [],
    });

    assert.equal(journal.valid, false);
    assert.ok(
      journal.failures.some(
        ({ code }) => code === "write-journal-operation-incomplete",
      ),
    );
  });
});

function pair(
  id: string,
  path: string,
  operation: "create-directory" | "create-file" | "replace-file",
): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    type: "intent",
    id,
    path,
    operation,
    plannedResult: "fixture result",
    proofs: {
      containment: "realpath contained",
      deliberateTarget: "temporary and atomic",
      materialization: "real bytes",
      freshReading: "fresh digest",
    },
  })}\n${JSON.stringify({
    schemaVersion: 1,
    type: "result",
    id,
    path,
    operation,
    outcome: "completed",
    actual: "fresh resulting digest",
  })}\n`;
}

function emptyOutcome(): ModulePassOutcome {
  return {
    maintenance: syntheticMaintenanceCoverage(),
    curated: [],
    rederived: [],
    superseded: [],
    withdrawn: [],
    parked: [],
    docWrites: [],
    failures: [],
    noted: [],
  };
}
