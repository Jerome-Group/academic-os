import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditModule, type Inventory } from "../../src/conformance/index.js";
import {
  contextualModuleDefinition,
  validModuleControls,
} from "../fixtures/module-controls.js";
import { universalPaths } from "../fixtures/universal-structure.js";
import { recordFindingEvidence } from "../support/rule-evidence.js";

const contextualPaths = [
  "20 Tutorials/CC0001",
  "20 Tutorials/CC0002",
  "30 Assessments/10 Quizzes",
  "30 Assessments/20 Tests",
  "30 Assessments/50 Assignments",
  "40 Projects and Labs/10 Projects",
  "40 Projects and Labs/10 Projects/10 Briefs",
  "40 Projects and Labs/10 Projects/20 References",
  "40 Projects and Labs/10 Projects/30 Working",
  "40 Projects and Labs/10 Projects/40 Data",
  "40 Projects and Labs/10 Projects/50 Submissions",
  "40 Projects and Labs/20 Labs",
  "40 Projects and Labs/20 Labs/10 Briefs",
  "40 Projects and Labs/20 Labs/20 References",
  "40 Projects and Labs/20 Labs/30 Working",
  "40 Projects and Labs/20 Labs/40 Data",
  "40 Projects and Labs/20 Labs/50 Submissions",
  "90 Resources/10 Formula Sheets",
  "NTULearn_Tutorial",
] as const;

function inventory(paths: readonly string[]): Inventory {
  return {
    moduleCode: "MH2100",
    entries: paths.map((path) => ({
      path,
      kind: "directory" as const,
      modifiedAt: "2026-08-11T00:00:00.000Z",
    })),
  };
}

function universalInventory(): Inventory {
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

describe("auditModule context-derived structure", () => {
  it("derives grouped tutorials and every approved optional directory [MF-ASSESSMENTS-001] [MF-TUTORIALS-001] [MF-WORKSPACES-001]", () => {
    const controls = validModuleControls();
    controls.definition = contextualModuleDefinition();
    const entries: Inventory["entries"] = universalInventory().entries;
    entries.push(...inventory(contextualPaths).entries);

    const result = auditModule({
      moduleCode: "MH2100",
      semester: "Y2S1",
      inventory: { moduleCode: "MH2100", entries },
      controls,
    });

    assert.equal(result.outcome, "conformant");
    for (const path of contextualPaths) {
      assert.equal(
        result.findings.some(
          (finding) => finding.path === path && finding.status === "pass",
        ),
        true,
        path,
      );
    }
    recordFindingEvidence(
      result.findings,
      "MF-ASSESSMENTS-001",
      "MF-TUTORIALS-001",
      "MF-WORKSPACES-001",
      "MF-OPEN-001",
      "MF-IMPORTER-001",
    );
  });

  it("reports missing approved structure and leaves absent optional structure absent", () => {
    const contextual = validModuleControls();
    contextual.definition = contextualModuleDefinition();
    const contextualResult = auditModule({
      moduleCode: "MH2100",
      semester: "Y2S1",
      inventory: universalInventory(),
      controls: contextual,
    });
    assert.equal(contextualResult.outcome, "deviation");
    assert.deepEqual(
      contextualResult.findings
        .filter(
          ({ status, path }) =>
            status === "fail" && contextualPaths.includes(path as never),
        )
        .map(({ path }) => path),
      contextualPaths,
    );

    const flat = validModuleControls();
    flat.definition = (flat.definition ?? "").replace(
      "quizzes: {enabled: true, evidence: [assessment-profile]}",
      "quizzes: {enabled: false}",
    );
    const flatResult = auditModule({
      moduleCode: "MH2100",
      semester: "Y2S1",
      inventory: universalInventory(),
      controls: flat,
    });
    assert.equal(flatResult.outcome, "conformant");
    assert.equal(
      flatResult.findings.some(({ path }) =>
        contextualPaths.includes(path as never),
      ),
      false,
    );
  });

  it("rejects disabled fixed categories and requests decisions for undeclared opaque names", () => {
    const controls = validModuleControls();
    controls.definition = (controls.definition ?? "").replace(
      "quizzes: {enabled: true, evidence: [assessment-profile]}",
      "quizzes: {enabled: false}",
    );
    const entries = universalInventory().entries;
    entries.push(
      ...inventory([
        "20 Tutorials/Provider Group A",
        "30 Assessments/10 Quizzes",
        "40 Projects and Labs/10 Projects",
        "90 Resources/10 Formula Sheets",
        "NTULearn_Tutorial",
      ]).entries,
      {
        path: "NTULearn_Assessments",
        kind: "file",
        size: 0,
        modifiedAt: "2026-08-11T00:00:00.000Z",
      },
    );

    const result = auditModule({
      moduleCode: "MH2100",
      semester: "Y2S1",
      inventory: { moduleCode: "MH2100", entries },
      controls,
    });

    assert.equal(result.outcome, "requires-decision");
    assert.deepEqual(
      result.findings
        .filter(({ status }) => status !== "pass")
        .map(({ path, status }) => [path, status]),
      [
        ["30 Assessments/10 Quizzes", "fail"],
        ["40 Projects and Labs/10 Projects", "fail"],
        ["20 Tutorials/Provider Group A", "fail"],
        ["90 Resources/10 Formula Sheets", "fail"],
        ["NTULearn_Tutorial", "requires-decision"],
        ["NTULearn_Assessments", "requires-decision"],
      ],
    );
  });

  it("rejects additions beside the five exact workspace children", () => {
    const controls = validModuleControls();
    controls.definition = contextualModuleDefinition();
    const entries = universalInventory().entries;
    entries.push(...inventory(contextualPaths).entries);
    entries.push(
      ...inventory([
        "40 Projects and Labs/10 Projects/60 Other",
        "40 Projects and Labs/10 Projects/30 Working/Nested Freely",
      ]).entries,
    );

    const result = auditModule({
      moduleCode: "MH2100",
      semester: "Y2S1",
      inventory: { moduleCode: "MH2100", entries },
      controls,
    });

    assert.deepEqual(
      result.findings
        .filter(({ status }) => status !== "pass")
        .map(({ path, status }) => [path, status]),
      [["40 Projects and Labs/10 Projects/60 Other", "fail"]],
    );
  });
});
