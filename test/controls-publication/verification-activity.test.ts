import assert from "node:assert/strict";
import { it } from "node:test";
import {
  generationFiles,
  moduleAggregate,
} from "../../src/controls-publication/bundle.js";
import { validateGeneratedBundle } from "../../src/controls-publication/index.js";
import {
  activityBytes,
  deriveActivityCloseout,
  encodeCanonicalJson,
  freezeBytes,
  resolveActivityPreparation,
  validateControlTransition,
} from "../../src/controls/index.js";
import type { SupportedModuleData } from "../../src/controls/generated/supported-controls.js";
import { validateSupportedModuleData } from "../../src/controls/schema-registry.js";
import {
  provisionalReview,
  syntheticFragment,
  sourceBinding,
  syntheticQuestion,
  verificationControls,
} from "../controls/module-verification-fixtures.js";
import {
  activityFixture,
  activitySubmission,
} from "../module-activity/fixtures.js";

it("preserves every v2 assessment variant through pure closeout rederivation and refuses assessment edits while public native admission stays closed", () => {
  const fixture = activityFixture(false, 2);
  const bundle = structuredClone(fixture.bundle);
  function control(role: string) {
    const binding = bundle.controls.find((binding) => binding.role === role);
    assert.ok(binding);
    const value: unknown = JSON.parse(
      Buffer.from(activityBytes(binding.bytes)).toString(),
    );
    assert.ok(validateSupportedModuleData(value));
    return { binding, value };
  }
  const source = bundle.dependencies.find(
    (dependency) =>
      dependency.kind === "retained-original" &&
      dependency.evidenceId === "evidence:synthetic",
  );
  assert.ok(source);
  source.path = `.academic-os/retained-inputs/${sourceBinding.byteSha256}`;
  source.bytes = freezeBytes(syntheticQuestion);
  const evidence = control("evidence");
  assert.equal(evidence.value.role, "evidence");
  if (evidence.value.role !== "evidence") return;
  const entry = evidence.value.entries.find(
    (entry) => entry.id === "evidence:synthetic",
  );
  assert.ok(entry);
  entry.locator = {
    kind: "retained-original",
    path: source.path,
    ...sourceBinding,
  };
  entry.content = {
    kind: "known",
    value: sourceBinding.byteSha256,
    evidence: [{ kind: "evidence", id: "evidence:synthetic" }],
  };
  evidence.binding.bytes = freezeBytes(encodeCanonicalJson(evidence.value));
  for (const role of ["artifacts", "profile", "decisions"]) {
    const rich = verificationControls().find((value) => value.role === role);
    assert.ok(rich);
    const value: unknown = JSON.parse(
      JSON.stringify({
        ...rich,
        module: fixture.identity.module,
        moduleCode: fixture.identity.moduleCode,
      }).replaceAll("evidence:original", "evidence:synthetic"),
    );
    assert.ok(validateSupportedModuleData(value));
    const target = bundle.controls.find((binding) => binding.role === role);
    assert.ok(target);
    target.bytes = freezeBytes(encodeCanonicalJson(value));
  }
  const records = control("learning-records");
  assert.ok(
    records.value.role === "learning-records" &&
      records.value.schemaVersion === 2,
  );
  const fragment = {
    ...syntheticFragment,
    source: { kind: "evidence" as const, id: "evidence:synthetic" },
  };
  const base = provisionalReview();
  base.question.reference.id = "evidence:synthetic";
  base.independentReference.id = "evidence:synthetic";
  const variants = [
    "numeric",
    "qualitative",
    "unknown",
    "excluded",
    "unresolved",
    "rubric",
  ] as const;
  for (const variant of variants) {
    const review = structuredClone(base);
    review.id = `assessment:${variant}`;
    const criterion = review.criteria[0];
    assert.ok(criterion.applicability === "applies");
    criterion.observations = [{ kind: "evidence", id: "evidence:synthetic" }];
    criterion.basis = {
      kind: "inferred",
      sources: [fragment],
      rationale: "Synthetic explicit question",
      uncertainty: "No academic judgment asserted",
    };
    if (variant === "numeric")
      criterion.allocation = {
        kind: "numeric",
        unit: "points",
        maximum: "5",
        allocationSource: fragment,
        estimate: { kind: "known", value: "3" },
      };
    if (variant === "qualitative")
      criterion.allocation = {
        kind: "qualitative",
        bands: [
          { id: "band:one", label: "Synthetic band", descriptor: fragment },
        ],
        estimate: { kind: "band", id: "band:one" },
      };
    if (variant === "excluded")
      review.criteria = [
        {
          applicability: "excluded",
          id: "criterion:grammar",
          fragment,
          decision: { kind: "decision", id: "decision:terms" },
          reason: "Explicitly excluded, no allocation or penalty.",
        },
      ];
    if (variant === "unresolved")
      review.criteria = [
        {
          applicability: "unresolved",
          id: "criterion:unresolved",
          fragment,
          reason: "Exact applicability remains unresolved.",
        },
      ];
    if (variant === "rubric") {
      review.kind = "rubric-linked";
      criterion.basis = {
        kind: "rubric",
        fragment,
        applicabilityDecision: { kind: "decision", id: "decision:terms" },
      };
    }
    records.value.assessments.push(review);
  }
  records.binding.bytes = freezeBytes(encodeCanonicalJson(records.value));
  const aggregate = moduleAggregate(fixture.identity);
  function closure(value: typeof bundle, generationId: string) {
    return {
      moduleCode: fixture.identity.moduleCode,
      files: generationFiles(value, aggregate, generationId).map((file) => ({
        kind: "file" as const,
        path: file.path,
        bytes: activityBytes(file.bytes),
      })),
    };
  }
  const before = closure(bundle, "rich-before");
  const prep = resolveActivityPreparation({
    before,
    releaseDigest: "a".repeat(64),
    request: {
      candidateId: "candidate-rich",
      selection: {
        kind: "exact",
        target: {
          kind: "revision",
          unit: { kind: "unit", id: "unit:one" },
          topics: [{ kind: "topic", id: "topic:one" }],
        },
      },
      requested: { kind: "official" },
    },
  });
  const submission = activitySubmission(prep);
  const derived = deriveActivityCloseout(submission);
  const request = {
    candidateId: prep.candidateId,
    requestId: submission.requestId,
    releaseDigest: prep.releaseDigest,
  };
  assert.deepEqual(
    validateControlTransition({
      before,
      proposed: closure(derived.bundle, "rich-after"),
      request,
    }),
    [],
  );
  const binding = derived.bundle.controls.find(
    (binding) => binding.role === "learning-records",
  );
  assert.ok(binding);
  const value: unknown = JSON.parse(
    Buffer.from(activityBytes(binding.bytes)).toString(),
  );
  assert.ok(
    validateSupportedModuleData(value) && value.role === "learning-records",
  );
  assert.deepEqual(value.assessments, records.value.assessments);
  for (const [index, variant] of variants.entries()) {
    const changed = structuredClone(derived.bundle);
    const target = changed.controls.find(
      (binding) => binding.role === "learning-records",
    );
    assert.ok(target);
    const altered: Extract<SupportedModuleData, { role: "learning-records" }> =
      structuredClone(value);
    const assessment: (typeof altered.assessments)[number] | undefined =
      altered.assessments[index];
    assert.ok(assessment && "recordVersion" in assessment);
    assessment.uncertainty = `Changed ${variant} after preparation`;
    target.bytes = freezeBytes(encodeCanonicalJson(altered));
    const findings = validateControlTransition({
      before,
      proposed: closure(changed, `altered-${index}`),
      request,
    });
    assert.match(
      findings[0]?.evidence ?? "",
      /Immutable assessments.*changed/u,
    );
  }
  const refused = validateGeneratedBundle({
    bundleBytes: encodeCanonicalJson(bundle),
    aggregate,
  });
  assert.equal(refused.kind, "refused");
});
