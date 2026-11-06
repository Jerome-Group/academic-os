import type { Evidence } from "../../src/controls/generated/module-data-1.js";
import type { SupportedModuleData } from "../../src/controls/index.js";
import type {
  AssessmentReviewV2,
  Fragment,
} from "../../src/controls/generated/module-verification-1.js";
import {
  moduleCode,
  moduleId,
  jsonFile,
  generationPath,
  headPath,
  sha,
} from "./fixtures.js";
import {
  moduleDataControls,
  moduleDataFixture,
  evidenceRef,
} from "./module-data-fixtures.js";

export const syntheticQuestion = Buffer.from(
  "Explain cancellation. Maximum 5 points. Grammar is excluded.\n",
);
export const sourceBinding = {
  byteLength: syntheticQuestion.length,
  byteSha256: sha(syntheticQuestion),
};
export const syntheticFragment: Fragment = {
  source: evidenceRef,
  original: sourceBinding,
  extraction: sourceBinding,
  extractor: { name: "utf8-identity", version: "1", recipe: "utf8-identity/1" },
  location: { kind: "utf8-bytes", start: 0, length: syntheticQuestion.length },
  fragmentSha256: sha(syntheticQuestion),
};

export function provisionalReview(): AssessmentReviewV2 {
  return structuredClone({
    recordVersion: 2,
    id: "assessment:review",
    kind: "provisional",
    official: false,
    submission: {
      reference: { kind: "artifact", id: "artifact:questions" },
      bytes: sourceBinding,
    },
    question: { reference: evidenceRef, bytes: sourceBinding },
    component: "assessment-component:weekly-quiz",
    criteria: [
      {
        applicability: "applies",
        id: "criterion:reasoning",
        label: "Reasoning",
        basis: {
          kind: "inferred",
          sources: [syntheticFragment],
          rationale: "Synthetic question requests reasoning.",
          uncertainty: "Interpretation remains provisional.",
        },
        allocation: {
          kind: "unknown",
          reason: "No criterion-specific allocation observed.",
          observation: "Component weight is not criterion points.",
        },
        observations: [evidenceRef],
        reasoning: "Shape fixture only; no grading performed.",
      },
    ],
    aggregate: {
      kind: "not-aggregated",
      reason: "Unknown criterion allocation.",
    },
    reviewer: {
      actor: "Synthetic structural fixture",
      subject: sourceBinding,
      invocation: sourceBinding,
      independence: {
        kind: "attributed",
        limitations: ["No actual reviewer invocation or independence."],
      },
    },
    independentReference: evidenceRef,
    uncertainty: "No actual assessment.",
    limitations: ["Synthetic structure only."],
  });
}

export function verificationControls(): SupportedModuleData[] {
  return moduleDataControls().map((control): SupportedModuleData => {
    if (control.role === "learning-records")
      return {
        ...control,
        $schema: "urn:academic-os:module-data:2",
        schemaVersion: 2,
        assessments: [provisionalReview()],
      };
    if (control.role === "verification")
      return {
        $schema: "urn:academic-os:module-data:2",
        schemaVersion: 2,
        module: moduleId,
        moduleCode,
        role: "verification",
        protocol: "module-verification/1",
        activation: "candidate-required",
        runtime: sourceBinding,
        evaluationPolicy: {
          protocol: "module-review-evaluation/1",
          caseSet: "paired-24-plus-checker-3/1",
          threshold: "every-frozen-case",
          ordinaryReviewIndependence: "separate-per-review-evidence",
        },
        checks: [
          {
            kind: "assessment",
            id: "verification-check:assessment",
            submission: { kind: "artifact", id: "artifact:questions" },
            question: evidenceRef,
            applicabilityDecisions: [],
            allocationRequirement: "truthful-review",
          },
        ],
        adaptationDecisions: [],
        limitations: ["No runtime or evaluation."],
      };
    if (control.role === "evidence")
      return {
        ...control,
        entries: control.entries.map(
          (entry): Evidence =>
            entry.id === evidenceRef.id
              ? {
                  ...entry,
                  locator: {
                    kind: "retained-original",
                    path: ".academic-os/legacy/source.md",
                    ...sourceBinding,
                  },
                  content: {
                    kind: "known",
                    value: sourceBinding.byteSha256,
                    evidence: [evidenceRef],
                  },
                }
              : entry,
        ),
      };
    return control;
  });
}

export function verificationFixture(
  controls = verificationControls(),
  transform: (value: SupportedModuleData) => unknown = (value) => value,
) {
  const old = moduleDataFixture();
  const transformed = controls.map(transform);
  const files = controls.map((value, index) =>
    jsonFile(
      `.academic-os/control-generations/g1/${value.role}.json`,
      transformed[index],
    ),
  );
  const identity = old.find((file) => file.path.endsWith("identity.json"));
  if (!identity) throw new Error("Missing identity fixture.");
  const generation = jsonFile(generationPath, {
    $schema: "urn:academic-os:control-generation:2",
    schemaVersion: 2,
    coverage: "module-data",
    module: moduleId,
    moduleCode,
    generationId: "g1",
    controls: [
      {
        role: "module-identity",
        file: "identity.json",
        schema: "urn:academic-os:module-identity:1",
        byteSha256: sha(identity.bytes),
      },
      ...files.map((file, index) => ({
        role: controls[index]?.role,
        file: file.path.split("/").at(-1),
        schema: (() => {
          const value = transformed[index];
          return value && typeof value === "object" && "$schema" in value
            ? value.$schema
            : controls[index]?.$schema;
        })(),
        byteSha256: sha(file.bytes),
      })),
    ],
  });
  const head = jsonFile(headPath, {
    $schema: "urn:academic-os:module-head:1",
    schemaVersion: 1,
    module: moduleId,
    moduleCode,
    contractVersion: 8,
    generation: {
      id: "g1",
      file: generationPath,
      schema: "urn:academic-os:control-generation:2",
      byteSha256: sha(generation.bytes),
    },
  });
  return [
    head,
    generation,
    identity,
    ...files,
    {
      kind: "file" as const,
      path: ".academic-os/legacy/source.md",
      bytes: syntheticQuestion,
    },
  ];
}
