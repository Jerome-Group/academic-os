import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditModule, type Inventory } from "../../src/conformance/index.js";
import {
  contextualModuleDefinition,
  validModuleControls,
} from "../fixtures/module-controls.js";
import { learningWorkspacePaths } from "../fixtures/learning-workspace.js";
import { universalPaths } from "../fixtures/universal-structure.js";
import {
  recordBehaviorEvidence,
  recordFindingEvidence,
} from "../support/rule-evidence.js";
import { testModuleContract } from "../fixtures/module-contract.js";

const modifiedAt = "2026-08-11T00:00:00.000Z";
const vanillaDefinition = (validModuleControls().definition ?? "").replace(
  "quizzes: {enabled: true, evidence: [assessment-profile]}",
  "quizzes: {enabled: false}",
);

function inventory(): Inventory {
  return {
    moduleCode: "MH2100",
    entries: [...universalPaths, ...learningWorkspacePaths].map(
      ([path, kind]) => ({
        path,
        kind,
        ...(kind === "file" ? { size: 0 } : {}),
        modifiedAt,
      }),
    ),
  };
}

function add(
  target: Inventory,
  path: string,
  kind: "directory" | "file" = "directory",
): void {
  target.entries.push({
    path,
    kind,
    ...(kind === "file" ? { size: 0 } : {}),
    modifiedAt,
  });
}

function audit(target: Inventory, definition = vanillaDefinition) {
  const controls = validModuleControls();
  controls.definition = definition;
  return auditModule(
    {
      moduleCode: "MH2100",
      semester: "Y2S1",
      inventory: target,
      controls,
    },
    testModuleContract,
  );
}

describe("auditModule governed content", () => {
  it("rejects wrong fixed-path case, misplaced controls, and nesting in closed homes [MF-ADMIN-001] [MF-NAMING-001]", () => {
    const target = inventory();
    add(target, "10 Learning Materials/10 lecture materials");
    add(target, "00 Module Admin/Archive");
    add(target, "30 Assessments/30 Midterms/Archive");
    add(target, "70 Learning/10 lectures");
    add(target, "70 Learning/00 Module Profile.md", "file");

    const findings = audit(target).findings.filter(
      ({ status }) => status !== "pass",
    );

    assert.deepEqual(
      findings.map(({ ruleId, path }) => [ruleId, path]),
      [
        ["MF-NAMING-001", "10 Learning Materials/10 lecture materials"],
        ["MF-NAMING-001", "70 Learning/10 lectures"],
        ["MF-ADMIN-001", "00 Module Admin/Archive"],
        ["MF-ASSESSMENTS-001", "30 Assessments/30 Midterms/Archive"],
        ["MF-NAMING-001", "70 Learning/00 Module Profile.md"],
      ],
    );
    recordFindingEvidence(
      findings,
      "MF-ADMIN-001",
      "MF-NAMING-001",
      "MF-ASSESSMENTS-001",
    );
  });

  it("permits declared tutorial groups and nesting in every open interior [MF-OPEN-001]", () => {
    const target = inventory();
    const definition = contextualModuleDefinition();
    for (const path of [
      "20 Tutorials/CC0001",
      "20 Tutorials/CC0002",
      "30 Assessments/10 Quizzes",
      "30 Assessments/20 Tests",
      "30 Assessments/50 Assignments",
      "40 Projects and Labs/10 Projects",
      "40 Projects and Labs/20 Labs",
      "90 Resources/10 Formula Sheets",
      "NTULearn_Tutorial",
    ]) {
      add(target, path);
    }
    for (const workspace of ["10 Projects", "20 Labs"]) {
      for (const child of [
        "10 Briefs",
        "20 References",
        "30 Working",
        "40 Data",
        "50 Submissions",
      ]) {
        add(target, `40 Projects and Labs/${workspace}/${child}`);
      }
    }
    for (const path of [
      "10 Learning Materials/10 Lecture Materials/Week 01",
      "40 Projects and Labs/10 Projects/30 Working/Poster/Sources",
      "40 Projects and Labs/20 Labs/40 Data/Raw/Run 01",
      "90 Resources/10 Formula Sheets/Archived/2025",
      "70 Learning/Anything/Nested",
      "docs/notes/decisions",
      ".scratch/arbitrary/work",
      "NTULearn/Week 01/(provider copy).PDF",
      "NTULearn_Tutorial/Group A/odd_NAME.PDF",
    ]) {
      add(target, path, path.endsWith(".PDF") ? "file" : "directory");
    }

    const result = audit(target, definition);

    assert.equal(result.outcome, "conformant");
    assert.ok(result.findings.every(({ status }) => status === "pass"));
    recordFindingEvidence(result.findings, "MF-OPEN-001");
  });

  it("uses declared module-specific tutorial groups without opening deeper structure", () => {
    const target = inventory();
    const definition = vanillaDefinition.replace(
      "tutorials: {layout: flat}",
      "tutorials: {layout: grouped, groups: [provider-group_a], evidence: [course-site]}",
    );
    add(target, "20 Tutorials/provider-group_a");
    add(target, "20 Tutorials/provider-group_a/Week 01");

    const findings = audit(target, definition).findings.filter(
      ({ status }) => status !== "pass",
    );

    assert.deepEqual(
      findings.map(({ ruleId, path }) => [ruleId, path]),
      [["MF-TUTORIALS-001", "20 Tutorials/provider-group_a/Week 01"]],
    );
  });

  it("checks curated filenames only in governed academic homes [MF-NAMING-002] [MF-NAMING-003]", () => {
    const target = inventory();
    for (const path of [
      "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_03_Graph_Theory.pdf",
      "20 Tutorials/MH2100_Tutorial_01_Solutions.pdf",
      "30 Assessments/30 Midterms/MH2100_Midterm_2025_Graded.pdf",
      "40 Projects and Labs/MH2100_Project_01_Outline.pdf",
      "90 Resources/00 Unclassified/MH2100_Formula_Sheet.pdf",
      "10 Learning Materials/30 Personal Notes/MH2100_Note_08_Derivatives_III_And_IV.pdf",
      "10 Learning Materials/10 Lecture Materials/lecture_1.PDF",
      "20 Tutorials/MH2100_tutorial_1.pdf",
      "30 Assessments/40 Finals/MH2100_Final_2026.PDF",
      "90 Resources/00 Unclassified/MH2100_01.pdf",
      "10 Learning Materials/30 Personal Notes/MH2100_Note_ABC.pdf",
      "NTULearn/lecture_1.PDF",
      ".scratch/notes.tmp",
      "docs/reference.pdf",
      "70 Learning/free-form.pdf",
    ]) {
      add(target, path, "file");
    }

    const findings = audit(target).findings.filter(
      ({ ruleId, status }) => ruleId === "MF-NAMING-002" && status === "fail",
    );

    assert.deepEqual(
      findings.map(({ path }) => path),
      [
        "10 Learning Materials/10 Lecture Materials/lecture_1.PDF",
        "20 Tutorials/MH2100_tutorial_1.pdf",
        "30 Assessments/40 Finals/MH2100_Final_2026.PDF",
        "90 Resources/00 Unclassified/MH2100_01.pdf",
        "10 Learning Materials/30 Personal Notes/MH2100_Note_ABC.pdf",
      ],
    );
    recordFindingEvidence(findings, "MF-NAMING-002");
  });

  it("preserves declared importer descendants and classifies undeclared roots [MF-CURATION-002] [MF-IMPORTER-001]", () => {
    const target = inventory();
    const definition = vanillaDefinition.replace(
      "- {role: primary, destination: NTULearn, evidence: [course-site]}",
      "- {role: primary, destination: NTULearn, evidence: [course-site]}\n    - {role: tutorials, destination: NTULearn_Tutorial, evidence: [course-site]}",
    );
    add(target, "NTULearn_Tutorial");
    add(target, "NTULearn_Tutorial/(raw)/slides FINAL.PDF", "file");
    add(target, "NTULearn_Assessments");

    const findings = audit(target, definition).findings.filter(
      ({ status }) => status !== "pass",
    );

    assert.deepEqual(
      findings.map(({ ruleId, status, path }) => [ruleId, status, path]),
      [["MF-IMPORTER-001", "requires-decision", "NTULearn_Assessments"]],
    );
    assert.match(findings[0]?.evidence ?? "", /NTULearn_Assessments/u);
    assert.match(findings[0]?.explanation ?? "", /human decision/u);
    recordFindingEvidence(findings, "MF-IMPORTER-001");
    recordBehaviorEvidence("MF-CURATION-002", () => {
      assert.equal(
        findings.some(({ path }) => path.includes("(raw)")),
        false,
      );
    });
  });

  it("accepts workspace build layouts and rejects root and scratch builds [MF-LATEX-001]", () => {
    const target = inventory();
    for (const path of [
      "40 Projects and Labs/Poster",
      "40 Projects and Labs/Poster/MH2100_Poster_Source.tex",
      "40 Projects and Labs/Poster/build",
      "40 Projects and Labs/Orphan/build",
      "build",
      ".scratch/draft/build",
    ]) {
      add(target, path, path.endsWith(".tex") ? "file" : "directory");
    }

    const findings = audit(target).findings.filter(
      ({ ruleId, status }) => ruleId === "MF-LATEX-001" && status === "fail",
    );

    assert.deepEqual(
      findings.map(({ path }) => path),
      [".scratch/draft/build", "40 Projects and Labs/Orphan/build", "build"],
    );
    assert.equal(
      findings.some(({ path }) => path === "40 Projects and Labs/Poster/build"),
      false,
    );
    recordFindingEvidence(findings, "MF-LATEX-001");
  });

  it("classifies every finding and makes judgment findings request a decision", () => {
    const target = inventory();
    add(
      target,
      "30 Assessments/30 Midterms/MH2100_Midterm_final-final.pdf",
      "file",
    );
    add(target, "40 Projects and Labs/MH2100_Project_Final.pdf", "file");
    add(target, "30 Assessments/40 Finals/MH2100_Final_2026.pdf", "file");
    add(target, "30 Assessments/40 Finals/MH2100_Final_2026_Final.pdf", "file");

    const result = audit(target);
    const judgments = result.findings.filter(
      ({ ruleId }) => ruleId === "MF-NAMING-003",
    );

    assert.ok(
      result.findings.every(
        ({ enforcement }) =>
          enforcement === "deterministic" || enforcement === "judgment",
      ),
    );
    recordFindingEvidence(judgments, "MF-NAMING-003");
    assert.deepEqual(
      judgments.map(({ path }) => path),
      [
        "30 Assessments/30 Midterms/MH2100_Midterm_final-final.pdf",
        "40 Projects and Labs/MH2100_Project_Final.pdf",
        "30 Assessments/40 Finals/MH2100_Final_2026_Final.pdf",
      ],
    );
    assert.ok(
      judgments.every(
        ({ enforcement, status, evidence, explanation }) =>
          enforcement === "judgment" &&
          status === "requires-decision" &&
          evidence !== "" &&
          explanation.includes("human decision"),
      ),
    );
  });

  it("returns findings only and does not mutate the inventory", () => {
    const target = inventory();
    add(target, "30 Assessments/30 Midterms/Archive");
    const before = structuredClone(target);

    const result = audit(target);

    assert.deepEqual(target, before);
    assert.equal("operations" in result, false);
  });
});
