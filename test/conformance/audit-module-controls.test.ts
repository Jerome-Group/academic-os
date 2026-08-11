import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditModuleControls } from "../../src/conformance/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";

describe("auditModuleControls", () => {
  it("accepts valid module controls, including an empty curation register", () => {
    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls: validModuleControls(),
    });

    assert.equal(result.outcome, "conformant");
    assert.ok(result.findings.every(({ status }) => status === "pass"));
    assert.deepEqual(
      new Set(result.findings.map(({ ruleId }) => ruleId)),
      new Set([
        "MF-DEFINITION-001",
        "MF-DEFINITION-002",
        "MF-PROFILE-001",
        "MF-PROFILE-003",
        "MF-CURATION-001",
        "MF-AGENTS-001",
        "MF-AGENTS-002",
        "MF-CONTEXT-001",
      ]),
    );
  });

  it("reports every missing control with deterministic evidence", () => {
    const first = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls: {},
    });
    const second = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls: {},
    });

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

    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
    });

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

    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
    });

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

  it("requires a human decision for contradictory or insufficient evidence", () => {
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

    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
    });

    assert.equal(result.outcome, "requires-decision");
    assert.deepEqual(
      result.findings
        .filter(({ status }) => status === "requires-decision")
        .map(({ ruleId }) => ruleId),
      ["MF-DEFINITION-002", "MF-PROFILE-003"],
    );
  });

  it("fails unsupported schema and contract versions explicitly", () => {
    const controls = validModuleControls();
    controls.definition =
      controls.definition
        ?.replace("schema_version: 1", "schema_version: 2")
        .replace("contract_version: 1", "contract_version: 3") ?? "";

    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
    });
    const versionFinding = result.findings[0];

    assert.equal(result.outcome, "deviation");
    assert.equal(versionFinding?.status, "fail");
    assert.match(
      versionFinding?.evidence ?? "",
      /Unsupported schema_version 2/u,
    );
    assert.match(
      versionFinding?.evidence ?? "",
      /Unsupported contract_version 3/u,
    );
    assert.equal(
      result.findings.filter(({ ruleId }) => ruleId === "MF-DEFINITION-001")
        .length,
      1,
    );
  });

  it("rejects declared exceptions without evidence as malformed", () => {
    const controls = validModuleControls();
    controls.definition = (controls.definition ?? "").replace(
      "exceptions: []",
      "exceptions: [{rule: MF-NAMING-001, reason: Legacy name, evidence: []}]",
    );

    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
    });

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

    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
    });

    const shapeFinding = result.findings.find(
      ({ ruleId, status }) =>
        ruleId === "MF-DEFINITION-001" && status === "fail",
    );
    assert.match(
      shapeFinding?.evidence ?? "",
      /non-empty evidence reference list/u,
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

    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
    });

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

    const result = auditModuleControls({
      moduleCode: "MH2100",
      semester: "Y2S1",
      controls,
    });

    assert.equal(result.outcome, "conformant");
    assert.match(
      result.findings.find(({ ruleId }) => ruleId === "MF-CURATION-001")
        ?.evidence ?? "",
      /1 structurally valid event/u,
    );
  });
});
