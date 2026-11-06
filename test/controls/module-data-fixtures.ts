import type { ModuleDataControl } from "../../src/controls/index.js";
import type { SourceUse } from "../../src/controls/generated/module-data-1.js";
import {
  canonicalFixture,
  generationPath,
  headPath,
  identityPath,
  jsonFile,
  moduleCode,
  moduleId,
  sha,
} from "./fixtures.js";

export const evidenceRef = {
  kind: "evidence",
  id: "evidence:original",
} as const;
export const evidence = () => [evidenceRef] satisfies [typeof evidenceRef];
export const unknown = (reason = "Not established by retained evidence") => ({
  kind: "unknown" as const,
  reason,
  evidence: [],
});
export const known = <T>(value: T) => ({
  kind: "known" as const,
  value,
  evidence: evidence(),
});
const base = <R extends ModuleDataControl["role"]>(role: R) => ({
  $schema: "urn:academic-os:module-data:1" as const,
  schemaVersion: 1 as const,
  module: moduleId,
  moduleCode,
  role,
});
export const use = (): SourceUse => ({
  source: { kind: "source", id: "source:issued" },
  artifact: { kind: "artifact", id: "artifact:questions" },
  locator: "pages 1-2",
  role: "questions",
  evidence: evidence(),
});

export function moduleDataControls(): ModuleDataControl[] {
  return [
    {
      ...base("learning-workspace"),
      mission: { kind: "absent", evidence: [] },
      notes: [],
    },
    {
      ...base("definition"),
      offering: {
        academicYear: known("2025-2026"),
        semester: known(1),
        status: known("past"),
        timezone: unknown(),
        academicUnits: unknown(),
        prerequisites: unknown(),
        mutualExclusion: unknown(),
        courseType: unknown(),
      },
      structure: {
        tutorials: { kind: "flat", evidence: evidence() },
        quizzes: known(false),
        tests: unknown(),
        assignments: unknown(),
        projects: known(false),
        labs: known(false),
        resourceCategories: [],
      },
      importers: [
        {
          integration: "ntulearn",
          role: "primary",
          root: "NTULearn",
          evidence: evidence(),
        },
      ],
      exceptions: [],
    },
    {
      ...base("profile"),
      scope: [
        {
          id: "profile-claim:scope",
          claim: "Synthetic subject scope",
          evidence: evidence(),
        },
      ],
      teaching: [],
      assessments: [
        {
          id: "assessment-component:weekly-quiz",
          label: "Weekly quiz",
          family: "weekly-quiz",
          weight: unknown(),
          timing: unknown(),
          coverage: unknown(),
          policies: [],
          arrangements: [],
          evidence: evidence(),
        },
      ],
      sourceAuthority: [
        {
          source: { kind: "source", id: "source:issued" },
          rank: 1,
          governs: ["questions"],
          evidence: evidence(),
        },
      ],
      workspaces: [],
      gaps: [
        {
          id: "profile-gap:timing",
          gap: "Historical timing",
          consequence: "Cannot infer dates",
          nextEvidence: "Issued schedule",
        },
      ],
    },
    {
      ...base("evidence"),
      entries: [
        {
          id: "evidence:original",
          citation: "Retained synthetic source",
          locator: {
            kind: "retained-original",
            path: ".academic-os/legacy/source.md",
            byteSha256: "0".repeat(64),
            byteLength: 4,
          },
          checked: unknown(),
          content: unknown(),
        },
      ],
    },
    {
      ...base("artifacts"),
      sources: [
        {
          id: "source:issued",
          identity: {
            kind: "legacy",
            algorithm: "retained-legacy/1",
            originalId: "original-001",
            evidence: evidence(),
          },
          title: "Synthetic questions",
          locators: [
            { kind: "module-file", value: "20 Tutorials/Questions.pdf" },
          ],
          evidence: evidence(),
        },
      ],
      artifacts: [
        {
          id: "artifact:questions",
          path: "20 Tutorials/Questions.pdf",
          source: { kind: "source", id: "source:issued" },
          representation: {
            kind: "file",
            fingerprintPolicy: "observed-native/1",
            digest: unknown(),
            entries: [
              {
                pathBytesBase64: Buffer.from(
                  "20 Tutorials/Questions.pdf",
                ).toString("base64"),
                kind: "file",
                data: unknown(),
                mode: unknown(),
                flags: unknown(),
                mtimeNanoseconds: unknown(),
                birthtimeNanoseconds: unknown(),
                acl: unknown(),
                xattrs: unknown(),
                resourceFork: {
                  kind: "unknown",
                  reason: "Not observed",
                  evidence: [],
                },
                symlinkTargetBytesBase64: null,
                specialType: null,
                hardlinkGroup: unknown(),
              },
            ],
            bundleMembers: [],
            evidence: evidence(),
          },
          traits: {
            content: ["questions"],
            annotation: known("annotated"),
            grading: known("graded"),
          },
          evidence: evidence(),
        },
      ],
    },
    {
      ...base("source-map"),
      availability: { kind: "mapped", evidence: evidence() },
      teachingWeeks: [
        { id: "teaching-week:6", label: "6", evidence: evidence() },
      ],
      units: [
        {
          id: "unit:10",
          label: "10",
          topics: ["a", "b", "c"].map((id) => ({
            id: `topic:${id}`,
            title: `Topic ${id}`,
            evidence: evidence(),
          })),
          teachingWeeks: [{ kind: "teaching-week", id: "teaching-week:6" }],
          lectures: [use()],
          textbook: [],
          tutorials: [
            {
              id: "tutorial-block:one",
              label: "Synthetic exercise block",
              exercises: "1-2",
              teachingWeeks: [{ kind: "teaching-week", id: "teaching-week:6" }],
              sources: [use()],
              missing: [
                {
                  role: "solutions",
                  reason: "Not issued",
                  evidence: evidence(),
                },
              ],
              evidence: evidence(),
            },
          ],
          supplementary: [],
          evidence: evidence(),
        },
        {
          id: "unit:2",
          label: "2",
          topics: [
            { id: "topic:d", title: "Fourth topic", evidence: evidence() },
          ],
          teachingWeeks: [],
          lectures: [],
          textbook: [],
          tutorials: [],
          supplementary: [],
          evidence: evidence(),
        },
      ],
    },
    {
      ...base("decisions"),
      entries: [
        {
          id: "decision:terms",
          status: "accepted",
          scope: { domain: "terminology", subjects: ["weekly quiz"] },
          consequences: [
            {
              kind: "distinguish",
              subject: "weekly quiz",
              value: "Separate assessment family",
            },
          ],
          rationale: "Sequence numbers overlap between assessment families.",
          evidence: evidence(),
          supersedes: [],
        },
      ],
    },
    {
      ...base("terms"),
      entries: [
        {
          id: "term:weekly-quiz",
          term: "Weekly quiz",
          meaning: "Lecture-hour quiz family",
          avoid: ["Quiz"],
          consequences: [{ kind: "naming", value: "Retain assessment family" }],
          decision: { kind: "decision", id: "decision:terms" },
          evidence: evidence(),
          supersedes: [],
        },
      ],
    },
    {
      ...base("preferences"),
      sharedBundle: {
        id: "shared-teaching",
        version: "1",
        byteSha256: "0".repeat(64),
        evidence: evidence(),
      },
      refinements: [
        {
          id: "preference:module-language",
          setting: "module-language",
          value: "Use issued vocabulary",
          ownerDecision: { kind: "decision", id: "decision:terms" },
          evidence: evidence(),
        },
      ],
    },
    {
      ...base("learning-records"),
      records: [
        {
          id: "learning-record:legacy",
          kind: "legacy-evidence",
          original: evidenceRef,
          parsedTarget: { kind: "unknown", reason: "No target recorded" },
          observedStatus: unknown("No status recorded"),
          established: ["observed-session"],
          missing: ["target", "status"],
          supersedes: [],
          evidence: evidence(),
        },
        {
          id: "learning-record:current",
          kind: "current",
          date: unknown(),
          target: {
            kind: "revision",
            unit: { kind: "unit", id: "unit:10" },
            topics: [
              { kind: "topic", id: "topic:a" },
              { kind: "topic", id: "topic:b" },
            ],
          },
          coverage: "requested-target-covered",
          understanding: { kind: "unassessed", reason: "Guided coverage only" },
          sources: [{ kind: "artifact", id: "artifact:questions" }],
          produced: [],
          assessments: [],
          evidence: evidence(),
          supersedes: [
            { kind: "learning-record", id: "learning-record:legacy" },
          ],
        },
      ],
      assessments: [],
    },
    {
      ...base("revisit"),
      entries: [
        {
          id: "revisit:one",
          question: "Reconstruct the omitted case",
          understandingLimit: "Not yet demonstrated unaided",
          state: "open",
          ownerDecision: null,
          evidence: evidence(),
        },
      ],
    },
    {
      ...base("glossary"),
      entries: [
        {
          id: "concept:one",
          term: "Synthetic concept",
          definition: "Its module-specific meaning",
          notation: ["X"],
          uncertainty: unknown(),
          sources: evidence(),
        },
      ],
    },
    {
      ...base("resources"),
      entries: [
        {
          id: "resource:one",
          title: "External reference",
          role: "reference",
          locator: "https://example.test/reference",
          artifact: null,
          checked: known(false),
          use: "Named by issued source; external contents unverified",
          evidence: evidence(),
        },
      ],
    },
    { ...base("textbooks"), entries: [] },
    {
      ...base("curation"),
      events: [
        {
          id: "curation-event:one",
          decision: "curated",
          source: { kind: "source", id: "source:issued" },
          artifacts: [{ kind: "artifact", id: "artifact:questions" }],
          original: evidenceRef,
          identityPolicy: "retained-legacy/1",
          supersedes: [],
          rationale: "Retained source placement",
          evidence: evidence(),
        },
      ],
      segments: [
        {
          evidence: evidenceRef,
          schema: "legacy-curation/3",
          identityPolicy: "retained-legacy/1",
        },
      ],
    },
    {
      ...base("provider-mirrors"),
      entries: [
        {
          id: "provider-mirror:tasks",
          provider: "google-tasks",
          authority: "provider",
          targetId: "exact-list-id",
          snapshot: evidenceRef,
          pullReceipt: evidenceRef,
          items: [
            {
              providerId: "exact-task-id",
              title: "Recorded task",
              status: known("completed"),
              tombstone: false,
              provenance: evidence(),
            },
          ],
          evidence: evidence(),
        },
      ],
    },
    {
      ...base("verification"),
      checks: [
        {
          id: "verification-check:structure",
          kind: "structural",
          capability: "module.validate",
          prerequisites: [],
          requiredEvidence: ["schema-and-graph-report"],
          sources: evidence(),
        },
      ],
      limitations: ["No publication, workflow or migration implementation"],
    },
  ];
}

export function controlFor<R extends ModuleDataControl["role"]>(
  controls: readonly ModuleDataControl[],
  role: R,
): Extract<ModuleDataControl, { role: R }> {
  const value = controls.find(
    (value): value is Extract<ModuleDataControl, { role: R }> =>
      value.role === role,
  );
  if (value === undefined) throw new Error(`Missing fixture role ${role}`);
  return value;
}

export function moduleDataFixture(
  controls: readonly ModuleDataControl[] = moduleDataControls(),
  transform: (control: ModuleDataControl) => unknown = (control) => control,
) {
  const identity = canonicalFixture().find(
    (file) => file.path === identityPath,
  );
  if (identity === undefined) throw new Error("Fixture identity absent");
  const files = controls.map((value) =>
    jsonFile(
      `.academic-os/control-generations/g1/${value.role}.json`,
      transform(value),
    ),
  );
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
        schema: "urn:academic-os:module-data:1",
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
  return [head, generation, identity, ...files];
}
