import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditModuleControls } from "../../src/conformance/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { recordFindingEvidence } from "../support/rule-evidence.js";
import { testModuleContract } from "../fixtures/module-contract.js";

describe("auditModuleControls", () => {
  it("accepts valid controls [MF-AGENTS-001] [MF-AGENTS-002] [MF-AGENTS-004] [MF-CONTEXT-001] [MF-CURATION-001] [MF-DEFINITION-001] [MF-DEFINITION-002] [MF-PROFILE-001] [MF-PROFILE-003]", () => {
    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls: validModuleControls(),
      },
      testModuleContract,
    );

    assert.equal(result.outcome, "conformant");
    assert.ok(result.findings.every(({ status }) => status === "pass"));
    assert.deepEqual(
      new Set(result.findings.map(({ ruleId }) => ruleId)),
      new Set([
        "MF-DEFINITION-001",
        "MF-DEFINITION-002",
        "MF-PROFILE-001",
        "MF-PROFILE-002",
        "MF-PROFILE-003",
        "MF-CURATION-001",
        "MF-AGENTS-001",
        "MF-AGENTS-002",
        "MF-AGENTS-004",
        "MF-CONTEXT-001",
      ]),
    );
    recordFindingEvidence(
      result.findings,
      "MF-AGENTS-001",
      "MF-AGENTS-002",
      "MF-AGENTS-004",
      "MF-CONTEXT-001",
      "MF-CURATION-001",
      "MF-DEFINITION-001",
      "MF-DEFINITION-002",
      "MF-PROFILE-001",
      "MF-PROFILE-002",
      "MF-PROFILE-003",
    );
  });

  it("reports every missing control with deterministic evidence", () => {
    const first = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls: {},
      },
      testModuleContract,
    );
    const second = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls: {},
      },
      testModuleContract,
    );

    assert.equal(first.outcome, "deviation");
    assert.deepEqual(first, second);
    assert.deepEqual(
      first.findings.map(({ path }) => path),
      [
        "00 Module Admin/10 Module Definition.yaml",
        "00 Module Admin/00 Module Profile.md",
        "00 Module Admin/20 Curation Register.jsonl",
        "AGENTS.md",
        "CLAUDE.md",
        "CONTEXT.md",
        "AGENTS.md",
        "docs/00 Structure and Naming.md",
        "docs/10 Curation Procedure.md",
        "docs/20 Teaching Procedure.md",
        "docs/30 Textbook Procedure.md",
      ],
    );
    assert.ok(
      first.findings.every(({ evidence }) =>
        evidence.includes("No readable control"),
      ),
    );
  });

  it("rejects malformed controls and malformed curation events", () => {
    const controls = validModuleControls();
    controls.definition = "schema_version: [\n";
    controls.profile = "# MH2100\n\n## Scope\n";
    controls.curationRegister =
      '{"schema_version":1,"decision":"curated"}\nnot-json\n';
    controls.agents = "# What this folder is\n";
    controls.claude = "Read AGENTS.md\n";
    controls.context = "# Bananas\n\nPurpose.\n\n## Language\n";

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.equal(result.outcome, "deviation");
    assert.ok(result.findings.every(({ evidence }) => evidence !== ""));
    assert.match(
      result.findings.find(({ ruleId }) => ruleId === "MF-CURATION-001")
        ?.evidence ?? "",
      /Line 1 requires non-empty source_id.*Line 2 is not JSON/u,
    );
    assert.equal(
      result.findings.find(({ ruleId }) => ruleId === "MF-PROFILE-001")?.status,
      "fail",
    );
    assert.equal(
      result.findings.find(({ ruleId }) => ruleId === "MF-CONTEXT-001")?.status,
      "fail",
    );
  });

  it("requires both domain-documentation pointers in AGENTS.md", () => {
    const controls = validModuleControls();
    controls.agents = (controls.agents ?? "").replace(
      "`docs/adr/`",
      "docs/adr/",
    );

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    const finding = result.findings.find(
      ({ ruleId }) => ruleId === "MF-AGENTS-001",
    );
    assert.equal(finding?.status, "fail");
    assert.match(finding?.evidence ?? "", /no `docs\/adr\/` pointer/u);
  });

  it("requires all eight routes in AGENTS.md", () => {
    const controls = validModuleControls();
    controls.agents = (controls.agents ?? "").replace(
      "- **Textbooks**",
      "- Textbooks",
    );

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    const finding = result.findings.find(
      ({ ruleId }) => ruleId === "MF-AGENTS-001",
    );
    assert.equal(finding?.status, "fail");
    assert.match(finding?.evidence ?? "", /Textbooks has no route bullet/u);
  });

  it("rejects repository workflow reaching AGENTS.md without flagging ordinary words", () => {
    const controls = validModuleControls();
    const clean = auditModuleControls(
      { moduleCode: "MH2100", semester: "Y2S1", controls },
      testModuleContract,
    );
    controls.agents = `${controls.agents ?? ""}\nDigits are legitimate; open a gitlab issue.\n`;
    const dirty = auditModuleControls(
      { moduleCode: "MH2100", semester: "Y2S1", controls },
      testModuleContract,
    );

    assert.equal(
      clean.findings.find(({ ruleId }) => ruleId === "MF-AGENTS-001")?.status,
      "pass",
    );
    const finding = dirty.findings.find(
      ({ ruleId }) => ruleId === "MF-AGENTS-001",
    );
    assert.equal(finding?.status, "fail");
    assert.match(
      finding?.evidence ?? "",
      /prohibited repository-workflow term "git"/u,
    );
  });

  it("flags a pinned copy that drifts from its seed-source template [MF-AGENTS-004]", () => {
    const controls = validModuleControls();
    controls.agents = (controls.agents ?? "").replace(
      "## Safety",
      "## Safety\n\nMH2100 keeps its own rule here.",
    );
    delete controls.curationProcedure;

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    const pinned = result.findings.filter(
      ({ ruleId }) => ruleId === "MF-AGENTS-004",
    );
    assert.equal(result.outcome, "deviation");
    assert.deepEqual(
      pinned.filter(({ status }) => status === "fail").map(({ path }) => path),
      ["AGENTS.md", "docs/10 Curation Procedure.md"],
    );
    assert.match(
      pinned.find(({ path }) => path === "AGENTS.md")?.evidence ?? "",
      /differs from seed-templates\/AGENTS\.template\.md at line \d+/u,
    );
    recordFindingEvidence(result.findings, "MF-AGENTS-004");
  });

  it("flags a pinned copy interpolated for the wrong module [MF-AGENTS-004]", () => {
    const result = auditModuleControls(
      {
        moduleCode: "MH2101",
        semester: "Y2S1",
        controls: validModuleControls(),
      },
      testModuleContract,
    );

    assert.equal(
      result.findings.find(
        ({ ruleId, path }) =>
          ruleId === "MF-AGENTS-004" && path === "AGENTS.md",
      )?.status,
      "fail",
    );
    recordFindingEvidence(result.findings, "MF-AGENTS-004");
  });

  it("rejects short Profile rows and malformed optional destinations", () => {
    const controls = validModuleControls();
    controls.profile = (controls.profile ?? "").replace(
      "| --- | --- | --- |\n| Academic year | 2026-2027 | Definition |",
      "| --- |\n| Academic year |",
    );
    controls.curationRegister = `${JSON.stringify({
      schema_version: 1,
      source_id: "ntulearn:content-123",
      integration: "ntulearn",
      role: "primary",
      source_path: "Week 01/Slides.pdf",
      decision: "source-only",
      destination: 42,
      evidence: "course menu",
      timestamp: "2026-08-11T12:00:00+08:00",
    })}\n`;

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.equal(result.outcome, "deviation");
    assert.match(
      result.findings.find(({ ruleId }) => ruleId === "MF-PROFILE-001")
        ?.evidence ?? "",
      /full-width separator/u,
    );
    assert.match(
      result.findings.find(({ ruleId }) => ruleId === "MF-CURATION-001")
        ?.evidence ?? "",
      /destination is allowed only for curated decisions/u,
    );
  });

  it("requires a human decision for contradictory controls", () => {
    const controls = validModuleControls();
    controls.profile =
      controls.profile?.replace(
        "# MH2100 — Calculus III",
        "# MH2100 — A Different Title",
      ) ?? "";
    controls.definition =
      controls.definition?.replace(
        "quizzes: {enabled: true, evidence: [assessment-profile]}",
        "quizzes: {enabled: unknown}",
      ) ?? "";

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.equal(result.outcome, "requires-decision");
    assert.deepEqual(
      result.findings
        .filter(({ status }) => status === "requires-decision")
        .map(({ ruleId }) => ruleId),
      ["MF-DEFINITION-002", "MF-PROFILE-003"],
    );
  });

  it("requires a human decision when Profile facts lack evidence [MF-PROFILE-002]", () => {
    const controls = validModuleControls();
    controls.profile =
      controls.profile?.replace(
        "| Semester | 1 | Definition |",
        "| Semester | 1 |  |",
      ) ?? "";

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.deepEqual(
      result.findings
        .filter(({ status }) => status === "requires-decision")
        .map(({ ruleId }) => ruleId),
      ["MF-PROFILE-002"],
    );
  });

  it("requires explicit unknown instead of ambiguous Profile placeholders", () => {
    const controls = validModuleControls();
    controls.profile = controls.profile?.replace("| Week 7 |", "| TBD |") ?? "";

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.match(
      result.findings.find(({ ruleId }) => ruleId === "MF-PROFILE-002")
        ?.evidence ?? "",
      /write unknown explicitly/u,
    );
  });

  it("fails unsupported schema and contract versions explicitly", () => {
    const controls = validModuleControls();
    controls.definition =
      controls.definition
        ?.replace("schema_version: 2", "schema_version: 3")
        .replace("contract_version: 3", "contract_version: 4") ?? "";

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );
    const versionFinding = result.findings[0];

    assert.equal(result.outcome, "deviation");
    assert.equal(versionFinding?.status, "fail");
    assert.match(
      versionFinding?.evidence ?? "",
      /Unsupported schema_version 3/u,
    );
    assert.match(
      versionFinding?.evidence ?? "",
      /Unsupported contract_version 4/u,
    );
    assert.equal(
      result.findings.filter(({ ruleId }) => ruleId === "MF-DEFINITION-001")
        .length,
      1,
    );
  });

  it("rejects absolute paths and undeclared private Definition fields [MF-DEFINITION-001]", () => {
    const controls = validModuleControls();
    controls.definition = `${controls.definition?.replace(
      "source: NTULearn course site",
      "source: /Users/student/private",
    )}credentials: secret\n`;

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );
    const finding = result.findings.find(
      ({ ruleId, status }) =>
        ruleId === "MF-DEFINITION-001" && status === "fail",
    );

    assert.match(finding?.evidence ?? "", /absolute personal path/u);
    assert.match(finding?.evidence ?? "", /undeclared field credentials/u);
  });

  it("rejects declared exceptions without evidence as malformed", () => {
    const controls = validModuleControls();
    controls.definition = (controls.definition ?? "").replace(
      "exceptions: []",
      "exceptions: [{rule: MF-NAMING-001, reason: Legacy name, evidence: []}]",
    );

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    const shapeFinding = result.findings.find(
      ({ ruleId, status }) =>
        ruleId === "MF-DEFINITION-001" && status === "fail",
    );
    assert.match(
      shapeFinding?.evidence ?? "",
      /non-empty evidence reference list/u,
    );
  });

  it("rejects importer roots without evidence as malformed", () => {
    const controls = validModuleControls();
    controls.definition = (controls.definition ?? "").replace(
      ", evidence: [course-site]",
      "",
    );

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    const shapeFinding = result.findings.find(
      ({ ruleId, status }) =>
        ruleId === "MF-DEFINITION-001" && status === "fail",
    );
    assert.match(
      shapeFinding?.evidence ?? "",
      /non-empty evidence reference list/u,
    );
  });

  it("requires evidence-backed exact names for grouped tutorials and resources", () => {
    const controls = validModuleControls();
    controls.definition = (controls.definition ?? "")
      .replace(
        "tutorials: {layout: flat}",
        "tutorials: {layout: grouped, groups: [CC0001, CC0001]}",
      )
      .replace(
        "resource_categories: []",
        "resource_categories: [{name: 10 Formula Sheets, evidence: []}]",
      );

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.equal(result.outcome, "requires-decision");
    const evidence = result.findings
      .filter(({ status }) => status !== "pass")
      .map((finding) => finding.evidence)
      .join(" ");
    assert.match(evidence, /unique directory names/u);
    assert.match(evidence, /resource_categories\[0\].*evidence/u);
  });

  it("rejects contextual destinations that collide with universal paths", () => {
    const controls = validModuleControls();
    controls.definition = (controls.definition ?? "").replace(
      "- {role: primary, destination: NTULearn, evidence: [course-site]}",
      "- {role: primary, destination: NTULearn, evidence: [course-site]}\n    - {role: tutorials, destination: AGENTS.md, evidence: [course-site]}",
    );

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.match(
      result.findings
        .filter(({ status }) => status !== "pass")
        .map(({ evidence }) => evidence)
        .join(" "),
      /destination AGENTS\.md conflicts with universal structure/u,
    );
  });

  it("rejects a non-ISO curation timestamp", () => {
    const controls = validModuleControls();
    controls.curationRegister = `${JSON.stringify({
      schema_version: 1,
      source_id: "ntulearn:content-123",
      integration: "ntulearn",
      role: "primary",
      source_path: "Week 01/Slides.pdf",
      decision: "source-only",
      evidence: "course menu",
      timestamp: "August 11, 2026",
    })}\n`;

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.match(
      result.findings.find(({ ruleId }) => ruleId === "MF-CURATION-001")
        ?.evidence ?? "",
      /not an ISO 8601 instant/u,
    );
  });

  it("accepts a structurally valid curation event", () => {
    const controls = validModuleControls();
    controls.curationRegister = `${JSON.stringify({
      schema_version: 1,
      source_id: "ntulearn:content-123",
      integration: "ntulearn",
      role: "primary",
      source_path: "Week 01/Slides.pdf",
      checksum: "sha256:abc",
      decision: "curated",
      destination:
        "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_01.pdf",
      evidence: "classified from course menu",
      timestamp: "2026-08-11T12:00:00+08:00",
    })}\n`;

    const result = auditModuleControls(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
      },
      testModuleContract,
    );

    assert.equal(result.outcome, "conformant");
    assert.match(
      result.findings.find(({ ruleId }) => ruleId === "MF-CURATION-001")
        ?.evidence ?? "",
      /1 structurally valid event/u,
    );
  });
});
