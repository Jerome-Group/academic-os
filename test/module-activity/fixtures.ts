import type { ModuleDataControl } from "../../src/controls/generated/module-data-1.js";
import {
  activityBytes,
  activityRegistryDigest,
  digest,
  encodeCanonicalJson,
  freezeBytes,
} from "../../src/controls/index.js";
import { validateGeneratedBundle } from "../../src/controls-publication/index.js";
import type {
  Judgment,
  Preparation,
  SubmitInput,
} from "../../src/module-activity/generated/workflow.js";
import { publicationFixture } from "../controls-publication/fixtures.js";

export const syntheticActivityProcedure =
  "Synthetic Module procedure. Revision records retained evidence only. One topic. No native output, teaching or provider effect.\n";

export function activityFixture(block = false) {
  const fixture = publicationFixture();
  const bundle = structuredClone(fixture.bundle);
  const values = bundle.controls.flatMap((control) =>
    control.role === "module-identity"
      ? []
      : [
          JSON.parse(
            Buffer.from(activityBytes(control.bytes)).toString(),
          ) as ModuleDataControl,
        ],
  );
  const procedure = freezeBytes(
    Buffer.from(
      block
        ? syntheticActivityProcedure.replace(
            "One topic.",
            "Contiguous topics in one unit.",
          )
        : syntheticActivityProcedure,
    ),
  );
  const evidence = values.find((v) => v.role === "evidence");
  const map = values.find((v) => v.role === "source-map");
  const workspace = values.find((v) => v.role === "learning-workspace");
  const records = values.find((v) => v.role === "learning-records");
  if (!evidence || !map || !workspace || !records)
    throw new Error("Incomplete fixture.");
  evidence.entries.push({
    id: "evidence:procedure",
    citation: "Synthetic full procedure",
    locator: {
      kind: "retained-original",
      path: `.academic-os/retained-inputs/${procedure.byteSha256}`,
      byteLength: procedure.byteLength,
      byteSha256: procedure.byteSha256,
    },
    content: {
      kind: "known",
      value: procedure.byteSha256,
      evidence: [{ kind: "evidence", id: "evidence:procedure" }],
    },
    checked: { kind: "unknown", reason: "Synthetic fixture", evidence: [] },
  });
  bundle.dependencies.splice(1, 0, {
    kind: "retained-original",
    evidenceId: "evidence:procedure",
    path: `.academic-os/retained-inputs/${procedure.byteSha256}`,
    bytes: procedure,
  });
  map.availability = {
    kind: "mapped",
    evidence: [{ kind: "evidence", id: "evidence:synthetic" }],
  };
  map.units = [
    {
      id: "unit:one",
      label: "Synthetic unit",
      topics: ["one", "two", "three"].map((n) => ({
        id: `topic:${n}`,
        title: `Synthetic topic ${n}`,
        evidence: [{ kind: "evidence" as const, id: "evidence:synthetic" }],
      })),
      teachingWeeks: [],
      lectures: [],
      textbook: [],
      tutorials: [],
      supplementary: [],
      evidence: [{ kind: "evidence", id: "evidence:synthetic" }],
    },
  ];
  workspace.activityProtocol = {
    schema: "urn:academic-os:module-activity:1",
    bindingId: block
      ? "synthetic-retained-block-revision-1"
      : "synthetic-retained-revision-1",
    procedureEvidenceId: "evidence:procedure",
    profileRegistryDigest: activityRegistryDigest,
  };
  records.activityCloseouts = [];
  for (const binding of bundle.controls) {
    const value = values.find((v) => v.role === binding.role);
    if (value) binding.bytes = freezeBytes(encodeCanonicalJson(value));
  }
  const validated = validateGeneratedBundle({
    bundleBytes: encodeCanonicalJson(bundle),
    aggregate: {
      kind: "module",
      module: fixture.identity.module,
      moduleCode: fixture.identity.moduleCode,
    },
  });
  if (validated.kind !== "validated")
    throw new Error(validated.evidence.join(" "));
  const before = {
    moduleCode: fixture.identity.moduleCode,
    files: validated.files,
  };
  return {
    ...fixture,
    bundle,
    bundleBytes: encodeCanonicalJson(bundle),
    before,
  };
}

export function activityJudgment(
  kind: Judgment["kind"],
  subjectDigest: string,
  evidenceId = "evidence:account",
): Judgment {
  return {
    id: `judgment:${kind}`,
    kind,
    author: "Synthetic attributed author",
    subjectDigest,
    evidenceIds: [evidenceId],
    reasoning: "Synthetic claim with exact scope; no academic truth asserted.",
    limitations: ["Synthetic evidence only."],
    authority: "attributed-claim",
  };
}

export function activitySubmission(
  preparation: Preparation,
  requestId = "activity-a",
): SubmitInput {
  if (preparation.official.membership.kind !== "declared")
    throw new Error("Declared fixture scope required.");
  const coveredMembers = [...preparation.official.membership.orderedMembers];
  return {
    preparation,
    requestId,
    date: { kind: "unknown", reason: "No date claim asserted.", evidence: [] },
    supersedes: [],
    evidence: {
      packets: [
        {
          id: `evidence:${requestId}:account`,
          role: "coverage-account",
          bytes: freezeBytes(
            Buffer.from(`Retained synthetic coverage ${requestId}.\n`),
          ),
        },
      ],
      coverage: {
        official: "covered",
        requested: "covered",
        coveredMembers,
        judgment: activityJudgment(
          "coverage",
          digest({ preparationDigest: digest(preparation), coveredMembers }),
          `evidence:${requestId}:account`,
        ),
      },
      understanding: { kind: "unassessed", reason: "No unaided attempt." },
      assessment: { kind: "unassessed" },
      artifacts: [
        {
          kind: "not-required",
          reason: "Synthetic retained-only operation.",
          judgment: activityJudgment(
            "artifact-not-required",
            digest({
              preparationDigest: digest(preparation),
              output: "revision-note-or-reference",
            }),
            `evidence:${requestId}:account`,
          ),
        },
      ],
      providers: [{ kind: "not-requested" }],
      unresolved: [],
    },
  };
}
