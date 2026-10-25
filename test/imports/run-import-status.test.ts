import assert from "node:assert/strict";
import { it } from "node:test";

import type { AcademicConfig } from "../../src/config/index.js";
import { runImportStatus } from "../../src/imports/index.js";
import { reportCohort } from "../fixtures/report-cohort.js";

function observe(config: AcademicConfig) {
  return runImportStatus({
    config,
    observedAt: "2026-09-07T22:00:00.000Z",
    maxAgeHours: 36,
  });
}

it("requires an examined Module before reporting current imports", async (context) => {
  const config = await reportCohort(context);
  const active = config.semesters.Y2S1;
  assert.ok(active);
  const current = await observe(config);
  assert.equal(current.outcome, "current");
  assert.equal(current.summary.roots.current, 1);
  assert.equal(current.modules[0]?.status, "observed");

  active.modules = [];
  const empty = await observe(config);
  assert.equal(empty.outcome, "invalid");
  assert.deepEqual(empty.modules, []);
  assert.deepEqual(empty.selection, {
    included: [],
    excluded: [],
    unresolved: [],
  });
});

it("retains unresolved duplicate evidence when no Module can be examined", async (context) => {
  const config = await reportCohort(context);
  config.semesters.Y2S2 = {
    root: "Future",
    status: "future",
    modules: ["MH2100"],
  };
  const report = await observe(config);
  assert.equal(report.outcome, "invalid");
  assert.deepEqual(report.modules, []);
  assert.deepEqual(report.selection.unresolved, [
    { semester: "Y2S1", module: "MH2100", reason: "duplicated-module" },
    { semester: "Y2S2", module: "MH2100", reason: "duplicated-module" },
  ]);
});
