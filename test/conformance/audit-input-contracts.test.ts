import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditModule,
  type ModuleControls,
} from "../../src/conformance/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { learningWorkspacePaths } from "../fixtures/learning-workspace.js";
import { testModuleContract } from "../fixtures/module-contract.js";
import { universalPaths } from "../fixtures/universal-structure.js";

function controls(): ModuleControls {
  const result = validModuleControls();
  result.definition = (result.definition ?? "").replace(
    "quizzes: {enabled: true, evidence: [assessment-profile]}",
    "quizzes: {enabled: false}",
  );
  return result;
}

function audit(
  controls: ModuleControls,
  extraPaths: string[] = [],
  importerRoots: string[] = [],
) {
  return auditModule(
    {
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
      inventory: {
        moduleCode: "MH2100",
        entries: [
          ...[...universalPaths, ...learningWorkspacePaths].map(
            ([path, kind]) => ({ path, kind }),
          ),
          ...extraPaths.map((path) => ({ path, kind: "file" as const })),
          ...importerRoots.map((path) => ({
            path,
            kind: "directory" as const,
          })),
        ],
      },
    },
    testModuleContract,
  );
}

function declareImporter(controls: ModuleControls, destination: string): void {
  if (destination === "NTULearn") return;
  controls.definition = (controls.definition ?? "").replace(
    "    - {role: primary, destination: NTULearn, evidence: [course-site]}",
    `    - {role: primary, destination: NTULearn, evidence: [course-site]}\n    - {role: supplementary, destination: ${destination}, evidence: [course-site]}`,
  );
}

describe("Module audit input contracts", () => {
  it("exempts importer control names while retaining misplaced Module controls", () => {
    const input = controls();
    declareImporter(input, "ProviderMirror");
    const imported = ["NTULearn", "ProviderMirror"].flatMap((root) =>
      ["CONTEXT.md", "AGENTS.md", "00 Module Profile.md"].map(
        (name) => `${root}/Week 01/${name}`,
      ),
    );
    const misplaced = "70 Learning/CONTEXT.md";
    const findings = audit(
      input,
      [...imported, misplaced],
      ["ProviderMirror"],
    ).findings.filter(
      ({ ruleId, status }) => ruleId === "MF-NAMING-001" && status === "fail",
    );

    assert.deepEqual(
      findings.map(({ path }) => path),
      [misplaced],
    );
  });

  it("rejects non-scalar Definition enums before deriving Tutorial context", () => {
    for (const layout of ["[flat]", "[grouped]", "{value: grouped}"]) {
      const input = controls();
      input.definition = (input.definition ?? "").replace(
        "layout: flat",
        `layout: ${layout}`,
      );
      const result = audit(input);
      assert.ok(
        result.findings.some(
          ({ ruleId, status, evidence }) =>
            ruleId === "MF-DEFINITION-001" &&
            status === "fail" &&
            evidence.includes("structure.tutorials.layout"),
        ),
        layout,
      );
    }
    for (const status of [
      "[active]",
      "[past]",
      "[future]",
      "{value: active}",
    ]) {
      const input = controls();
      input.definition = (input.definition ?? "").replace(
        "status: active",
        `status: ${status}`,
      );
      assert.ok(
        audit(input).findings.some(
          ({ ruleId, status, evidence }) =>
            ruleId === "MF-DEFINITION-001" &&
            status === "fail" &&
            evidence.includes("offering.status"),
        ),
        status,
      );
    }
  });

  it("retains scalar offering states and requires grouped Tutorial evidence", () => {
    for (const status of ["active", "past", "future"]) {
      const input = controls();
      input.definition = (input.definition ?? "").replace(
        "status: active",
        `status: ${status}`,
      );
      assert.equal(audit(input).outcome, "conformant", status);
    }
    const input = controls();
    input.definition = (input.definition ?? "").replace(
      "layout: flat",
      "layout: grouped",
    );
    const finding = audit(input).findings.find(
      ({ ruleId, status }) =>
        ruleId === "MF-DEFINITION-001" && status === "fail",
    );
    assert.match(finding?.evidence ?? "", /groups.*evidence/u);
  });

  it("judges direct Profile importer-interior citations in every provenance table", () => {
    for (const root of ["NTULearn", "ProviderMirror"]) {
      for (const { original, replacement } of [
        {
          original: "| Academic year | 2026-2027 | Definition |",
          replacement: `| Academic year | 2026-2027 | ${root}/Week 01/slides.pdf |`,
        },
        {
          original: "| Midterm | 30% | Week 7 | NTULearn |",
          replacement: `| Midterm | 30% | Week 7 | ${root}/Week 01/slides.pdf |`,
        },
        {
          original: "| 1 | NTULearn | Primary | Offering | Current course |",
          replacement: `| 1 | NTULearn | Primary | Offering | ${root}/Week 01/slides.pdf |`,
        },
      ]) {
        const input = controls();
        declareImporter(input, root);
        for (const provenance of ["Evidence", "Checked"]) {
          input.profile = (input.profile ?? "")
            .replace(original, replacement)
            .replace(
              "| Rank | Source | Role | Governs | Evidence |",
              `| Rank | Source | Role | Governs | ${provenance} |`,
            );
          const finding = audit(input).findings.find(
            ({ ruleId }) => ruleId === "MF-PROFILE-002",
          );
          assert.equal(finding?.status, "requires-decision", replacement);
          assert.match(finding?.evidence ?? "", /importer.*interior/iu);
        }
      }
    }
  });

  it("accepts importer landmarks and named documents in Profile evidence", () => {
    for (const root of ["NTULearn", "ProviderMirror"]) {
      for (const evidence of [
        root,
        `${root}/`,
        `${root}/Course.md`,
        `${root}/Last synced.md`,
        `${root}/Announcements`,
        `${root}/Announcements/`,
        "slides.pdf",
        "NTULearn assessment profile",
      ]) {
        const input = controls();
        if (root !== "NTULearn") declareImporter(input, root);
        input.profile = (input.profile ?? "").replace(
          "| Academic year | 2026-2027 | Definition |",
          `| Academic year | 2026-2027 | ${evidence} |`,
        );
        assert.equal(
          audit(input, [], root === "NTULearn" ? [] : [root]).outcome,
          "conformant",
          evidence,
        );
      }
    }
  });

  it("restricts importer landmarks to exact citations in every Module control", () => {
    for (const root of ["NTULearn", "ProviderMirror"]) {
      for (const interior of [
        "Announcements/Week 01/slides.pdf",
        "Course.md/child.pdf",
        "Last synced.md/child.pdf",
        "Course.md/",
        "Last synced.md/",
        "/Week 01/slides.pdf",
        "/Course.md",
        "Announcements//",
        "/",
      ]) {
        const input = controls();
        declareImporter(input, root);
        const citation = `${root}/${interior}`;
        input.profile = (input.profile ?? "").replace(
          "| Academic year | 2026-2027 | Definition |",
          `| Academic year | 2026-2027 | ${citation} |`,
        );
        input.definition = (input.definition ?? "").replace(
          "source: NTULearn course site",
          `source: ${citation}`,
        );
        input.taskRegister = `list_id: synthetic-list\ntasks:\n  - title: Read the notice\n    status: open\n    provenance:\n      source: ${citation}\n`;
        const result = audit(input);
        for (const [rule, status] of [
          ["MF-PROFILE-002", "requires-decision"],
          ["MF-DEFINITION-001", "fail"],
          ["MF-TASKS-001", "fail"],
        ]) {
          const finding = result.findings.find(({ ruleId }) => ruleId === rule);
          assert.equal(finding?.status, status, `${rule} ${citation}`);
          assert.match(finding?.evidence ?? "", /importer.*interior/iu);
        }
      }
      for (const citation of [
        root,
        `${root}/`,
        `${root}/Course.md`,
        `${root}/Last synced.md`,
        `${root}/Announcements`,
        `${root}/Announcements/`,
        "slides.pdf",
        "NTULearn assessment profile",
      ]) {
        const input = controls();
        declareImporter(input, root);
        input.profile = (input.profile ?? "").replace(
          "| Academic year | 2026-2027 | Definition |",
          `| Academic year | 2026-2027 | ${citation} |`,
        );
        input.definition = (input.definition ?? "").replace(
          "source: NTULearn course site",
          `source: ${citation}`,
        );
        input.taskRegister = `list_id: synthetic-list\ntasks:\n  - title: Read the notice\n    status: open\n    provenance:\n      source: ${citation}\n`;
        assert.equal(
          audit(input, [], root === "NTULearn" ? [] : [root]).outcome,
          "conformant",
          citation,
        );
      }
    }
  });
});
