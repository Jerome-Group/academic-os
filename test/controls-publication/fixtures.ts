import type { SupportedModuleData } from "../../src/controls/generated/supported-controls.js";
import type { ModuleDataControl } from "../../src/controls/generated/module-data-1.js";
import type { ModuleIdentity } from "../../src/controls/generated/module-identity-1.js";
import {
  encodePublication,
  freezeBytes,
} from "../../src/controls-publication/codec.js";
import type { PublicationBundle } from "../../src/controls-publication/generated/publication-contract-1.js";

export function publicationFixture(
  title = "Synthetic private controls",
  dataVersion: 1 | 2 = 1,
) {
  const documents: (ModuleIdentity | ModuleDataControl)[] = [
    {
      $schema: "urn:academic-os:module-identity:1",
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      schemaVersion: 1,
      title: "Synthetic private controls",
    },
    {
      $schema: "urn:academic-os:module-data:1",
      exceptions: [],
      importers: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      offering: {
        academicUnits: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        academicYear: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        courseType: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        mutualExclusion: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        prerequisites: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        semester: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        status: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        timezone: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
      },
      role: "definition",
      schemaVersion: 1,
      structure: {
        assignments: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        labs: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        projects: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        quizzes: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        resourceCategories: [],
        tests: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
        tutorials: {
          evidence: [],
          kind: "unknown",
          reason: "Synthetic value",
        },
      },
    },
    {
      $schema: "urn:academic-os:module-data:1",
      assessments: [],
      gaps: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "profile",
      schemaVersion: 1,
      scope: [],
      sourceAuthority: [],
      teaching: [],
      workspaces: [],
    },
    {
      $schema: "urn:academic-os:module-data:1",
      entries: [
        {
          checked: {
            evidence: [],
            kind: "unknown",
            reason: "No observation date asserted",
          },
          citation: "Synthetic retained original",
          content: {
            evidence: [
              {
                id: "evidence:synthetic",
                kind: "evidence",
              },
            ],
            kind: "known",
            value:
              "1ed7e89f177c23b9a874285c846f88a6905d3230bcb507b89f794b266d0cf0b6",
          },
          id: "evidence:synthetic",
          locator: {
            byteLength: 42,
            byteSha256:
              "1ed7e89f177c23b9a874285c846f88a6905d3230bcb507b89f794b266d0cf0b6",
            kind: "retained-original",
            path: ".academic-os/retained-inputs/1ed7e89f177c23b9a874285c846f88a6905d3230bcb507b89f794b266d0cf0b6",
          },
        },
      ],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "evidence",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      artifacts: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "artifacts",
      schemaVersion: 1,
      sources: [],
    },
    {
      $schema: "urn:academic-os:module-data:1",
      availability: {
        evidence: [],
        kind: "unknown",
        reason: "Synthetic value",
      },
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "source-map",
      schemaVersion: 1,
      teachingWeeks: [],
      units: [],
    },
    {
      $schema: "urn:academic-os:module-data:1",
      entries: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "terms",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      entries: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "decisions",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      refinements: [],
      role: "preferences",
      schemaVersion: 1,
      sharedBundle: {
        byteSha256:
          "3af0dd0a837456da9e019a7ee2b61631404e0600535dc0bca815c56065418a9f",
        evidence: [
          {
            id: "evidence:synthetic",
            kind: "evidence",
          },
        ],
        id: "synthetic-preferences",
        version: "1",
      },
    },
    {
      $schema: "urn:academic-os:module-data:1",
      assessments: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      records: [],
      role: "learning-records",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      entries: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "revisit",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      entries: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "glossary",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      entries: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "resources",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      entries: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "textbooks",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      events: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "curation",
      schemaVersion: 1,
      segments: [],
    },
    {
      $schema: "urn:academic-os:module-data:1",
      entries: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "provider-mirrors",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      checks: [],
      limitations: [],
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      role: "verification",
      schemaVersion: 1,
    },
    {
      $schema: "urn:academic-os:module-data:1",
      mission: {
        evidence: [],
        kind: "absent",
      },
      module: "module:synthetic",
      moduleCode: "ABCD1234A",
      notes: [],
      role: "learning-workspace",
      schemaVersion: 1,
    },
  ];
  const identity = documents.find(
    (document): document is ModuleIdentity => !("role" in document),
  );
  if (!identity) throw new Error("Missing synthetic identity.");
  identity.title = title;
  const supportedDocuments = documents.map(
    (document): ModuleIdentity | SupportedModuleData => {
      if (dataVersion === 1 || !("role" in document)) return document;
      if (document.role === "learning-records")
        return {
          ...document,
          $schema: "urn:academic-os:module-data:2",
          schemaVersion: 2,
        };
      if (document.role !== "verification") return document;
      const futureRuntime = freezeBytes(
        Buffer.from(
          "Synthetic future runtime binding. No executable verification.\n",
        ),
      );
      return {
        $schema: "urn:academic-os:module-data:2",
        schemaVersion: 2,
        module: document.module,
        moduleCode: document.moduleCode,
        role: "verification",
        protocol: "module-verification/1",
        activation: "candidate-required",
        runtime: {
          byteLength: futureRuntime.byteLength,
          byteSha256: futureRuntime.byteSha256,
        },
        evaluationPolicy: {
          protocol: "module-review-evaluation/1",
          caseSet: "paired-24-plus-checker-3/1",
          threshold: "every-frozen-case",
          ordinaryReviewIndependence: "separate-per-review-evidence",
        },
        checks: [{ kind: "controls", id: "verification-check:controls" }],
        adaptationDecisions: [],
        limitations: [
          "Synthetic declarations only. No runtime, grading, formal checker or evaluation.",
        ],
      };
    },
  );
  const bundle: PublicationBundle = {
    $schema: "urn:academic-os:publication-bundle:1",
    schemaVersion: 1,
    controls: supportedDocuments.map((document) => ({
      role: "role" in document ? document.role : "module-identity",
      file: `${"role" in document ? document.role : "module-identity"}.json`,
      bytes: freezeBytes(encodePublication(document)),
    })),
    dependencies: [
      {
        kind: "retained-original",
        evidenceId: "evidence:synthetic",
        path: ".academic-os/retained-inputs/1ed7e89f177c23b9a874285c846f88a6905d3230bcb507b89f794b266d0cf0b6",
        bytes: {
          byteLength: 42,
          byteSha256:
            "1ed7e89f177c23b9a874285c846f88a6905d3230bcb507b89f794b266d0cf0b6",
          bytesBase64:
            "U3ludGhldGljIHJldGFpbmVkIG9yaWdpbmFsLCBleGFjdCBieXRlcy4K",
        },
      },
      {
        kind: "shared-preferences",
        id: "synthetic-preferences",
        version: "1",
        path: ".academic-os/retained-inputs/3af0dd0a837456da9e019a7ee2b61631404e0600535dc0bca815c56065418a9f",
        bytes: {
          byteLength: 42,
          byteSha256:
            "3af0dd0a837456da9e019a7ee2b61631404e0600535dc0bca815c56065418a9f",
          bytesBase64:
            "U3ludGhldGljIHByZWZlcmVuY2UgYnVuZGxlLCBleGFjdCBieXRlcy4K",
        },
      },
    ],
    nativeArtifactEffects: [],
  };
  return {
    identity,
    identityBytes: encodePublication(identity),
    bundle,
    bundleBytes: encodePublication(bundle),
  };
}
