import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readControls,
  supportedControlSchemas,
} from "../../src/controls/index.js";
import type { SupportedModuleData } from "../../src/controls/index.js";
import { moduleCode } from "./fixtures.js";
import {
  moduleDataControls,
  controlFor,
  moduleDataFixture,
} from "./module-data-fixtures.js";
import {
  verificationControls,
  verificationFixture,
  syntheticFragment,
} from "./module-verification-fixtures.js";

function records(controls: SupportedModuleData[]) {
  const value = controls.find((value) => value.role === "learning-records");
  assert.ok(value?.role === "learning-records" && value.schemaVersion === 2);
  return value;
}
function review(controls: SupportedModuleData[]) {
  const value = records(controls).assessments.find(
    (entry) => "recordVersion" in entry,
  );
  assert.ok(value && "recordVersion" in value);
  return value;
}
function read(controls = verificationControls()) {
  return readControls({ moduleCode, files: verificationFixture(controls) });
}
function refuses(
  edit: (controls: SupportedModuleData[]) => void,
  code: string,
) {
  const controls = verificationControls();
  edit(controls);
  const result = read(controls);
  assert.equal(result.kind, "unsupported", JSON.stringify(result));
  assert.ok(
    result.diagnostics.some((item) => item.code === code),
    JSON.stringify(result.diagnostics),
  );
}

describe("versioned Module verification controls at the canonical reader", () => {
  it("derives exactly eighteen roles and only the two additional schema pairs", () => {
    assert.equal(
      new Set(supportedControlSchemas.map((entry) => entry.role)).size,
      18,
    );
    assert.deepEqual(
      supportedControlSchemas
        .filter((entry) => entry.schemaVersion === 2)
        .map((entry) => entry.role)
        .sort(),
      ["learning-records", "verification"],
    );
  });
  it("keeps v1 results and historical values/order unchanged while v2 remains explicitly unavailable", () => {
    const old = moduleDataControls();
    const result = readControls({ moduleCode, files: moduleDataFixture(old) });
    assert.ok(result.kind === "canonical");
    assert.equal("verification" in result.readiness, false);
    const controls = verificationControls();
    const historical = controlFor(old, "learning-records");
    const current = records(controls);
    current.assessments.unshift({
      id: "assessment:legacy",
      kind: "provisional",
      official: false,
      submission: { kind: "artifact", id: "artifact:questions" },
      question: { kind: "evidence", id: "evidence:original" },
      authority: { kind: "unknown", reason: "Retained original", evidence: [] },
      criteria: [
        {
          label: "Retained original",
          maximum: "2",
          estimated: "1",
          source: { kind: "evidence", id: "evidence:original" },
          observations: [{ kind: "evidence", id: "evidence:original" }],
          reasoning: "Original unverified assessment",
          uncertainty: {
            kind: "unknown",
            reason: "Retained original",
            evidence: [],
          },
        },
      ],
      independentReference: { kind: "evidence", id: "evidence:original" },
      limitations: [],
    });
    const selected = read(controls);
    assert.ok(
      selected.kind === "canonical",
      JSON.stringify(selected.diagnostics),
    );
    assert.equal(selected.shape.head.contractVersion, 8);
    assert.equal(selected.controls.length, 18);
    assert.equal(selected.readiness.verification, "not-implemented");
    assert.match(selected.limitations.join(" "), /does not execute checks/u);
    const retained = selected.controls.find(
      (control) => control.role === "learning-records",
    )?.value;
    assert.ok(
      retained && "role" in retained && retained.role === "learning-records",
    );
    assert.deepEqual(retained.records, historical.records);
    assert.deepEqual(retained.assessments, current.assessments);
  });
  it("rejects unsupported role/schema pairs and unknown fields with no legacy fallback", () => {
    for (const transform of [
      (value: SupportedModuleData) => ({ ...value, extra: "refuse" }),
      (value: SupportedModuleData) =>
        value.role === "profile"
          ? {
              ...value,
              $schema: "urn:academic-os:module-data:2",
              schemaVersion: 2,
            }
          : value,
    ]) {
      const result = readControls({
        moduleCode,
        files: verificationFixture(verificationControls(), transform),
      });
      assert.equal(result.kind, "unsupported");
      assert.equal(result.shape.detected, "canonical");
    }
  });
  it("separates missing source/component/attempt references from truthful unknown allocation", () => {
    assert.equal(read().kind, "canonical");
    refuses((controls) => {
      review(controls).question.reference.id = "evidence:absent";
    }, "missing-control-reference");
    refuses((controls) => {
      review(controls).submission.reference.id = "artifact:absent";
    }, "missing-control-reference");
    refuses((controls) => {
      review(controls).component = "assessment-component:absent";
    }, "missing-assessment-component");
  });
  it("keeps declared check identities distinct while refusing actual dangling nested references", () => {
    const controls = verificationControls();
    const verification = controls.find(
      (value) => value.role === "verification",
    );
    assert.ok(
      verification?.role === "verification" && verification.schemaVersion === 2,
    );
    verification.checks.push({
      kind: "controls",
      id: "verification-check:control-identity",
    });
    assert.equal(read(controls).kind, "canonical");
    verification.checks.push({
      kind: "artifact",
      id: "verification-check:nested-reference",
      artifact: { kind: "artifact", id: "artifact:questions" },
      requiredSources: [{ kind: "evidence", id: "evidence:missing" }],
    });
    const result = read(controls);
    assert.equal(result.kind, "unsupported");
    assert.ok(
      result.diagnostics.some(
        (finding) =>
          finding.code === "missing-control-reference" &&
          finding.pointer === "/checks/2/requiredSources/0",
      ),
    );
  });
  it("rejects source substitution, out-of-range fragments and changed actual fragment hashes", () => {
    refuses((controls) => {
      review(controls).question.bytes.byteSha256 = "f".repeat(64);
    }, "invalid-verification-binding");
    refuses((controls) => {
      const criterion = review(controls).criteria[0];
      assert.equal(criterion?.applicability, "applies");
      if (
        criterion?.applicability === "applies" &&
        criterion.basis.kind === "inferred"
      )
        criterion.basis.sources[0].location.start = Number.MAX_SAFE_INTEGER;
    }, "invalid-verification-binding");
    refuses((controls) => {
      const criterion = review(controls).criteria[0];
      if (
        criterion?.applicability === "applies" &&
        criterion.basis.kind === "inferred"
      )
        criterion.basis.sources[0].fragmentSha256 = "f".repeat(64);
    }, "invalid-verification-binding");
  });
  it("rejects inferred rubric authority, wrong Module decisions and allocations detached from criterion sources", () => {
    refuses((controls) => {
      review(controls).kind = "rubric-linked";
    }, "invalid-assessment-review");
    refuses((controls) => {
      const judgment = review(controls);
      const criterion = judgment.criteria[0];
      assert.ok(criterion?.applicability === "applies");
      judgment.kind = "rubric-linked";
      criterion.basis = {
        kind: "rubric",
        fragment: syntheticFragment,
        applicabilityDecision: { kind: "decision", id: "decision:terms" },
      };
      const decisions = controls.find(
        (control) => control.role === "decisions",
      );
      assert.ok(decisions?.role === "decisions");
      const decision = decisions.entries[0];
      assert.ok(decision);
      decision.scope.subjects = ["module:other"];
    }, "invalid-verification-binding");
    refuses((controls) => {
      const criterion = review(controls).criteria[0];
      assert.ok(criterion?.applicability === "applies");
      criterion.allocation = {
        kind: "numeric",
        unit: "points",
        maximum: "5",
        allocationSource: {
          ...syntheticFragment,
          source: { kind: "evidence", id: "evidence:unrelated" },
        },
        estimate: { kind: "known", value: "3" },
      };
    }, "invalid-assessment-review");
  });
  it("preserves exact decimals, refuses fabricated totals and never converts qualitative or unknown allocations", () => {
    const controls = verificationControls();
    const judgment = review(controls);
    const criterion = judgment.criteria[0];
    assert.ok(criterion?.applicability === "applies");
    criterion.allocation = {
      kind: "numeric",
      unit: "points",
      maximum: "5.00",
      allocationSource: syntheticFragment,
      estimate: { kind: "known", value: "2.50" },
    };
    judgment.aggregate = {
      kind: "numeric-estimate",
      value: "2.5",
      maximum: "5",
      aggregationSource: syntheticFragment,
      criterionIds: [criterion.id],
    };
    assert.equal(read(controls).kind, "canonical");
    judgment.aggregate.value = "2.5000000000000000000001";
    const invalid = read(controls);
    assert.equal(invalid.kind, "unsupported");
    judgment.aggregate.value = "2.5";
    criterion.allocation = {
      kind: "unknown",
      reason: "No allocation",
      observation: "No conversion",
    };
    assert.equal(read(controls).kind, "unsupported");
  });
  it("refuses excluded penalties, weighting-as-points and caller checked-formal fields through the schema", () => {
    const controls = verificationControls();
    const bad = readControls({
      moduleCode,
      files: verificationFixture(controls, (value) =>
        value.role === "learning-records"
          ? {
              ...value,
              assessments: [
                {
                  ...review(controls),
                  criteria: [
                    {
                      applicability: "excluded",
                      id: "criterion:grammar",
                      fragment: syntheticFragment,
                      decision: { kind: "decision", id: "decision:terms" },
                      reason: "Excluded",
                      allocation: { kind: "numeric", maximum: "0" },
                    },
                  ],
                },
              ],
            }
          : value,
      ),
    });
    assert.equal(bad.kind, "unsupported");
    for (const extra of [
      { unit: "weighting" },
      { kind: "formal-checked", exitCode: 0 },
    ]) {
      const result = readControls({
        moduleCode,
        files: verificationFixture(controls, (value) =>
          value.role === "learning-records"
            ? {
                ...value,
                assessments: [
                  {
                    ...review(controls),
                    criteria: [
                      {
                        ...review(controls).criteria[0],
                        allocation: {
                          kind: "numeric",
                          unit: "points",
                          maximum: "5",
                          allocationSource: syntheticFragment,
                          estimate: { kind: "known", value: "3" },
                          ...extra,
                        },
                      },
                    ],
                  },
                ],
              }
            : value,
        ),
      });
      assert.equal(result.kind, "unsupported");
    }
  });
});
