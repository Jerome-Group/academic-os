import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditUniversalStructure,
  type Inventory,
} from "../../src/conformance/index.js";
import { universalPaths } from "../fixtures/universal-structure.js";

function conformantInventory(): Inventory {
  return {
    moduleCode: "MH2100",
    entries: universalPaths.map(([path, kind]) => ({
      path,
      kind,
      ...(kind === "file" ? { size: 0 } : {}),
      modifiedAt: "2026-08-11T00:00:00.000Z",
    })),
  };
}

describe("auditUniversalStructure", () => {
  it("reports the universal structure as conformant", () => {
    const result = auditUniversalStructure(conformantInventory());

    assert.equal(result.outcome, "conformant");
    assert.ok(result.findings.every((finding) => finding.status === "pass"));
    assert.deepEqual(
      result.findings.map((finding) => finding.path),
      [...universalPaths.map(([path]) => path), "."],
    );
  });

  it("reports missing paths, wrong kinds, loose root files, and unknown root directories", () => {
    const inventory = conformantInventory();
    inventory.entries = inventory.entries.filter(
      (entry) => entry.path !== "30 Assessments/40 Finals",
    );
    inventory.entries.push(
      {
        path: "20 Tutorials",
        kind: "file",
        size: 12,
        modifiedAt: "2026-08-11T00:00:00.000Z",
      },
      {
        path: "Loose Notes.pdf",
        kind: "file",
        size: 12,
        modifiedAt: "2026-08-11T00:00:00.000Z",
      },
      {
        path: "README.txt",
        kind: "file",
        size: 12,
        modifiedAt: "2026-08-11T00:00:00.000Z",
      },
      {
        path: "50 Field Work",
        kind: "directory",
        modifiedAt: "2026-08-11T00:00:00.000Z",
      },
    );

    const result = auditUniversalStructure(inventory);

    assert.equal(result.outcome, "requires-decision");
    assert.deepEqual(
      result.findings
        .filter((finding) => finding.status !== "pass")
        .map(({ ruleId, status, severity, path }) => ({
          ruleId,
          status,
          severity,
          path,
        })),
      [
        {
          ruleId: "MF-UNIVERSAL-001",
          status: "fail",
          severity: "error",
          path: "20 Tutorials",
        },
        {
          ruleId: "MF-UNIVERSAL-001",
          status: "fail",
          severity: "error",
          path: "30 Assessments/40 Finals",
        },
        {
          ruleId: "MF-ROOT-002",
          status: "requires-decision",
          severity: "decision",
          path: "50 Field Work",
        },
        {
          ruleId: "MF-ROOT-002",
          status: "fail",
          severity: "error",
          path: "Loose Notes.pdf",
        },
      ],
    );
    assert.equal(
      result.findings.some(({ path }) => path === "README.txt"),
      false,
    );
    for (const finding of result.findings.filter(
      (candidate) => candidate.status !== "pass",
    )) {
      assert.notEqual(finding.evidence, "");
      assert.notEqual(finding.explanation, "");
      assert.notEqual(finding.applicability, "");
    }
  });
});
