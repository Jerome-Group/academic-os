import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditLearningWorkspace,
  type Inventory,
} from "../../src/conformance/index.js";
import { learningWorkspacePaths } from "../fixtures/learning-workspace.js";
import { recordFindingEvidence } from "../support/rule-evidence.js";

function workspaceInventory(): Inventory {
  return {
    moduleCode: "MH2100",
    entries: learningWorkspacePaths.map(([path, kind]) => ({
      path,
      kind,
      ...(kind === "file" ? { size: 0 } : {}),
      modifiedAt: "2026-08-11T00:00:00.000Z",
    })),
  };
}

describe("auditLearningWorkspace", () => {
  it("reports the seeded workspace as conformant [MF-LEARNING-001]", () => {
    const findings = auditLearningWorkspace(workspaceInventory());

    assert.ok(findings.every(({ status }) => status === "pass"));
    assert.deepEqual(
      findings.map(({ path }) => path),
      learningWorkspacePaths.map(([path]) => path),
    );
    recordFindingEvidence(findings, "MF-LEARNING-001");
  });

  it("reports a missing activity area, a missing records folder, and a file where a folder belongs", () => {
    const inventory = workspaceInventory();
    inventory.entries = inventory.entries.filter(
      ({ path }) =>
        path !== "70 Learning/30 Revision" &&
        path !== "70 Learning/10 Lectures/records",
    );
    inventory.entries.push({
      path: "70 Learning/30 Revision",
      kind: "file",
      size: 12,
      modifiedAt: "2026-08-11T00:00:00.000Z",
    });

    const findings = auditLearningWorkspace(inventory);

    assert.deepEqual(
      findings
        .filter(({ status }) => status !== "pass")
        .map(({ ruleId, status, severity, path }) => ({
          ruleId,
          status,
          severity,
          path,
        })),
      [
        {
          ruleId: "MF-LEARNING-001",
          status: "fail",
          severity: "error",
          path: "70 Learning/10 Lectures/records",
        },
        {
          ruleId: "MF-LEARNING-001",
          status: "fail",
          severity: "error",
          path: "70 Learning/30 Revision",
        },
      ],
    );
    for (const finding of findings) {
      assert.notEqual(finding.evidence, "");
      assert.notEqual(finding.explanation, "");
      assert.notEqual(finding.applicability, "");
    }
  });

  it("says nothing about what an activity area's own folders hold", () => {
    const inventory = workspaceInventory();
    for (const path of [
      "70 Learning/10 Lectures/Topic A",
      "70 Learning/10 Lectures/Topic A/build",
      "70 Learning/20 Tutorials/Sheet One",
      "70 Learning/40 Past Papers/Earlier Paper",
      "70 Learning/templates/local-macros.tex",
    ]) {
      inventory.entries.push({
        path,
        kind: path.endsWith(".tex") ? "file" : "directory",
        ...(path.endsWith(".tex") ? { size: 4 } : {}),
        modifiedAt: "2026-08-11T00:00:00.000Z",
      });
    }

    const findings = auditLearningWorkspace(inventory);

    assert.ok(findings.every(({ status }) => status === "pass"));
    assert.equal(findings.length, learningWorkspacePaths.length);
  });
});
