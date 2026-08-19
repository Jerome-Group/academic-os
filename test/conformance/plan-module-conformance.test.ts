import assert from "node:assert/strict";
import { it } from "node:test";

import {
  planModuleConformance,
  type Inventory,
  type ModuleContract,
} from "../../src/conformance/index.js";
import { testModuleContract } from "../fixtures/module-contract.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { learningWorkspacePaths } from "../fixtures/learning-workspace.js";
import { universalPaths } from "../fixtures/universal-structure.js";

it("plans findings, operations, and observations through one pure seam", () => {
  const inventory = conformantInventory();
  inventory.entries = inventory.entries.filter(
    ({ path }) => path !== "30 Assessments/40 Finals",
  );
  const before = structuredClone(inventory);

  const first = planModuleConformance({
    contract: testModuleContract,
    target: {
      moduleCode: "MH2100",
      semester: "Y2S1",
      identity: "/synthetic/Y2S1/MH2100",
    },
    controls: validModuleControls(),
    inventory,
    observedAt: "2026-08-12T00:00:00.000Z",
  });

  assert.equal(first.outcome, "deviation");
  assert.deepEqual(first.proposedOperations, [
    {
      kind: "create-directory",
      path: "30 Assessments/10 Quizzes",
      ruleId: "MF-ASSESSMENTS-001",
    },
    {
      kind: "create-directory",
      path: "30 Assessments/40 Finals",
      ruleId: "MF-UNIVERSAL-001",
    },
  ]);
  assert.equal(first.observation.target.identity, "/synthetic/Y2S1/MH2100");
  assert.equal(first.comparison.basis, "no-prior-observation");
  assert.deepEqual(inventory, before);

  const resolved = conformantInventory();
  resolved.entries.push({
    path: "30 Assessments/10 Quizzes",
    kind: "directory",
  });
  const second = planModuleConformance({
    contract: testModuleContract,
    target: first.observation.target,
    controls: validModuleControls(),
    inventory: resolved,
    priorObservation: first.observation,
    observedAt: "2026-08-12T01:00:00.000Z",
  });

  assert.equal(second.outcome, "conformant");
  assert.equal(second.comparison.basis, "compatible-observation");
  assert.equal(second.comparison.resolved.length, 2);
});

it("uses contract version and applicability as authoritative inputs", () => {
  const contract: ModuleContract = {
    ...testModuleContract,
    version: 5,
    ruleIds: testModuleContract.ruleIds.filter(
      (ruleId) => ruleId !== "MF-UNIVERSAL-001",
    ),
  };
  const inventory = conformantInventory();
  inventory.entries = inventory.entries.filter(
    ({ path }) => path !== "30 Assessments/40 Finals",
  );

  const plan = planModuleConformance({
    contract,
    target: {
      moduleCode: "MH2100",
      semester: "Y2S1",
      identity: "/synthetic/Y2S1/MH2100",
    },
    controls: validModuleControls(),
    inventory,
    observedAt: "2026-08-12T00:00:00.000Z",
  });

  assert.equal(plan.observation.contractVersion, 4);
  assert.equal(
    plan.findings.some(({ ruleId }) => ruleId === "MF-UNIVERSAL-001"),
    false,
  );
  assert.equal(
    plan.proposedOperations.some(({ ruleId }) => ruleId === "MF-UNIVERSAL-001"),
    false,
  );
  assert.equal(
    plan.findings.some(
      ({ ruleId, status, evidence }) =>
        ruleId === "MF-DEFINITION-001" &&
        status === "fail" &&
        evidence.includes("requested version 5"),
    ),
    true,
  );
});

function conformantInventory(): Inventory {
  return {
    moduleCode: "MH2100",
    entries: [...universalPaths, ...learningWorkspacePaths].map(
      ([path, kind]) => ({ path, kind }),
    ),
  };
}
