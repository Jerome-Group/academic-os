import assert from "node:assert/strict";
import { it } from "node:test";

import { runLearningMaterials } from "../../src/learning-materials/index.js";
import { reportCohort } from "../fixtures/report-cohort.js";

it("requires an examined Module before reporting available materials", async (context) => {
  const config = await reportCohort(context);
  const active = config.semesters.Y2S1;
  assert.ok(active);
  const available = await runLearningMaterials(config);
  assert.equal(available.outcome, "available");
  assert.equal(available.modules[0]?.assessment?.summary.available, 1);

  active.modules = [];
  const empty = await runLearningMaterials(config);
  assert.equal(empty.outcome, "incomplete");
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
  const report = await runLearningMaterials(config);
  assert.equal(report.outcome, "incomplete");
  assert.deepEqual(report.modules, []);
  assert.deepEqual(report.selection.unresolved, [
    { semester: "Y2S1", module: "MH2100", reason: "duplicated-module" },
    { semester: "Y2S2", module: "MH2100", reason: "duplicated-module" },
  ]);
});
