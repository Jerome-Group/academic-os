import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderModulePassSummary } from "../../src/commands/render-module-pass-summary.js";
import type { ModulePassReport } from "../../src/routine/index.js";

const quiet: ModulePassReport = {
  module: "AB1234",
  semester: "Y2S1",
  artifacts: "/state/routine/sessions/2026-08-25/AB1234",
  curated: [],
  rederived: [],
  superseded: [],
  withdrawn: [],
  parked: [],
  docWrites: [],
  failures: [],
};

describe("the run's one-line summary of a module pass", () => {
  it("counts every bucket the report carries, in the report's order", () => {
    assert.equal(
      renderModulePassSummary(quiet),
      "AB1234 (Y2S1): 0 curated, 0 rederived, 0 superseded, 0 withdrawn, 0 parked, 0 doc writes, 0 failures",
    );
  });

  // The bug this pins: a decision the register gained but the terminal line never learned to count,
  // so a morning that closed a departed source reported nothing at the operator's screen.
  it("says so when the morning withdrew something", () => {
    assert.match(
      renderModulePassSummary({
        ...quiet,
        withdrawn: [
          { item: "source/removed-page.md", evidence: "Follows precedent." },
        ],
      }),
      /1 withdrawn/u,
    );
  });
});
