import assert from "node:assert/strict";
import { it } from "node:test";

import type { ImportStatusReport } from "../../src/imports/index.js";
import { importStatusPrelude } from "../../src/routine/import-status-prelude.js";

function report(): ImportStatusReport {
  return {
    schemaVersion: 1,
    mode: "imports-status",
    activeSemester: "Y2S1",
    observedAt: "2026-09-07T22:00:00.000Z",
    maxAgeHours: 24,
    outcome: "current",
    selection: { included: [], excluded: [], unresolved: [] },
    summary: {
      roots: {
        current: 1,
        stale: 0,
        running: 0,
        partial: 0,
        failed: 0,
        missing: 0,
        invalid: 0,
      },
      invalidModules: 0,
    },
    modules: [
      {
        module: { semester: "Y2S1", module: "AB1234" },
        status: "observed",
        roots: [
          {
            destination: "NTULearn",
            status: "current",
            action: "none",
            counts: {
              downloaded: 2,
              skipped: 3,
              markdown: 4,
              uncopied: 0,
              failures: 0,
            },
            startedAt: "2026-09-07T21:00:00.000Z",
            finishedAt: "2026-09-07T21:10:00.000Z",
            lastSuccessfulAt: "2026-09-07T21:10:00.000Z",
            unread: [],
          },
        ],
      },
    ],
  };
}

it("reports current importer evidence without creating an attention trigger", () => {
  const prelude = importStatusPrelude(report());
  assert.equal(prelude.outcome, "current");
  assert.equal(prelude.parked, 0);
  assert.equal(prelude.failure, undefined);
  assert.match(prelude.detail.join("\n"), /AB1234\/NTULearn: current/u);
  assert.match(prelude.detail.join("\n"), /maximum age 24 hours/u);
});

it("parks partial importer evidence with actionable counts while retaining its current sibling", () => {
  const input = report();
  const root = input.modules[0]?.roots[0];
  assert.ok(root);
  assert.ok(root.counts);
  input.outcome = "attention";
  input.modules[0]?.roots.push({
    ...root,
    destination: "NTULearn_Tutorial",
    status: "partial",
    action: "inspect and retry the NTULearn sync",
    counts: { ...root.counts, failures: 1 },
    unread: ["announcements"],
  });
  const prelude = importStatusPrelude(input);
  assert.equal(prelude.outcome, "attention");
  assert.equal(prelude.parked, 1);
  assert.equal(prelude.failure, undefined);
  const detail = prelude.detail.join("\n");
  assert.match(detail, /AB1234\/NTULearn: current/u);
  assert.match(detail, /NTULearn_Tutorial: partial/u);
  assert.match(detail, /unread announcements; failed transfers 1/u);
  assert.match(detail, /defer source-withdrawal decisions/u);
});

it("exposes unresolved controls independently of healthy roots", () => {
  const input = report();
  input.outcome = "invalid";
  input.selection.unresolved.push({
    semester: "Y2S1",
    module: "CD5678",
    reason: "invalid-definition",
  });
  input.modules.push({
    module: { semester: "Y2S1", module: "CD5678" },
    status: "invalid",
    roots: [],
    error: {
      code: "invalid-definition",
      message: "Definition could not be read",
    },
  });
  const prelude = importStatusPrelude(input);
  assert.equal(prelude.parked, 1);
  assert.equal(prelude.failure?.code, "import-status-invalid");
  assert.match(
    prelude.detail.join("\n"),
    /Unresolved Y2S1\/CD5678: invalid-definition/u,
  );
  assert.match(prelude.detail.join("\n"), /AB1234\/NTULearn: current/u);
});
