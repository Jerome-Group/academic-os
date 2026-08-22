import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planPinnedDocumentRewrite } from "../../src/pinned/index.js";
import {
  interpolateModuleCode,
  pinnedDocumentPaths,
} from "../../src/contract/pinned-documents.js";
import { testModuleContract } from "../fixtures/module-contract.js";

const teachingProcedure = pinnedDocumentPaths.teachingProcedure;

function seededControls(module: string) {
  return Object.fromEntries(
    Object.entries(testModuleContract.pinnedDocuments).map(([name, body]) => [
      name,
      interpolateModuleCode(body, module),
    ]),
  );
}

function observedModule(module: string) {
  return { module, semester: "Y2S1", controls: seededControls(module) };
}

describe("planPinnedDocumentRewrite", () => {
  it("reports a fully seeded cohort as current and plans no rewrite", () => {
    const plan = planPinnedDocumentRewrite({
      modules: [observedModule("MH2100"), observedModule("MH3210")],
      pinnedDocuments: testModuleContract.pinnedDocuments,
    });

    assert.equal(plan.outcome, "current");
    assert.deepEqual(plan.counts, { current: 12, stale: 0, missing: 0 });
    assert.deepEqual(plan.rewrites, []);
  });

  it("names the first differing line of a stale copy", () => {
    const observed = observedModule("MH2100");
    observed.controls.teachingProcedure = (
      observed.controls.teachingProcedure ?? ""
    ).replace("# Teaching Procedure", "# How MH2100 Is Taught");

    const plan = planPinnedDocumentRewrite({
      modules: [observed],
      pinnedDocuments: testModuleContract.pinnedDocuments,
    });

    assert.equal(plan.outcome, "stale");
    assert.equal(plan.counts.stale, 1);
    const [rewrite] = plan.rewrites;
    assert.equal(rewrite?.module, "MH2100");
    assert.equal(rewrite?.path, teachingProcedure);
    assert.equal(rewrite?.state, "stale");
    assert.match(
      rewrite?.evidence ?? "",
      /^Pinned copy differs from seed-templates\/docs\/20 Teaching Procedure\.template\.md at line 1, which reads "# How MH2100 Is Taught" rather than "# Teaching Procedure"\.$/u,
    );
  });

  it("plans a rewrite for a copy that is not there at all", () => {
    const observed = observedModule("MH2100");
    delete observed.controls.teachingProcedure;

    const plan = planPinnedDocumentRewrite({
      modules: [observed],
      pinnedDocuments: testModuleContract.pinnedDocuments,
    });

    assert.equal(plan.counts.missing, 1);
    const [rewrite] = plan.rewrites;
    assert.equal(rewrite?.state, "missing");
    assert.equal(
      rewrite?.evidence,
      `No readable copy exists at ${teachingProcedure}.`,
    );
  });

  it("carries the interpolated body each module is owed, never the template's placeholder", () => {
    const stale = observedModule("MH3210");
    stale.controls.agents = "# Replaced\n";

    const plan = planPinnedDocumentRewrite({
      modules: [stale],
      pinnedDocuments: testModuleContract.pinnedDocuments,
    });

    const [rewrite] = plan.rewrites;
    assert.equal(rewrite?.expected.includes("MODULE_CODE"), false);
    assert.equal(rewrite?.expected.includes("MH3210"), true);
  });

  it("orders rewrites by module then by document, so two runs read the same", () => {
    const first = planPinnedDocumentRewrite({
      modules: [observedModule("MH3210"), observedModule("CC0006")].map(
        (m) => ({
          ...m,
          controls: { ...m.controls, agents: "# Replaced\n", context: "" },
        }),
      ),
      pinnedDocuments: testModuleContract.pinnedDocuments,
    });

    assert.deepEqual(
      first.rewrites.map(({ module, path }) => [module, path]),
      [
        ["CC0006", pinnedDocumentPaths.agents],
        ["MH3210", pinnedDocumentPaths.agents],
      ],
    );
  });
});
