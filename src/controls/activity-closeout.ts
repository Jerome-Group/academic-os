import type {
  ActivityEvidence,
  ExactWrites,
  LogicalCloseout,
  Preparation,
  StoredCloseout,
  SubmitInput,
} from "../module-activity/generated/workflow.js";
import { preparationClosure, sameValue } from "./activity-closure.js";
import {
  validateActivityEvidence,
  validateSupersession,
} from "./activity-evidence.js";
import { activityRefusal } from "./activity-failure.js";
import { parseActivity, requireActivitySize } from "./activity-packets.js";
import {
  prepareFromClosure,
  recognizeActivityProtocol,
} from "./activity-preparation.js";
import { digest, freezeBytes } from "./canonical-json.js";
import type { Evidence, LearningRecord } from "./generated/module-data-1.js";
import { moduleDataRoles } from "./validate-module-graph.js";

export function deriveActivityCloseout(input: SubmitInput) {
  const closure = preparationClosure(input.preparation);
  const prep = input.preparation;
  const rederived = prepareFromClosure(
    closure,
    {
      candidateId: prep.candidateId,
      selection: { kind: "exact", target: prep.official.target },
      requested: prep.requested,
      sessionInstructions: prep.preferences.sessionInstructions,
    },
    prep.releaseDigest,
  );
  if (!sameValue(prep, rederived))
    activityRefusal(
      "evidence-mismatch",
      "Preparation metadata, sources, procedure, preferences or exact closure was rebound.",
    );
  const old = closure.control("learning-records");
  const history = old.activityCloseouts;
  if (!history)
    activityRefusal(
      "illegal-transition",
      "Enabled protocol requires an explicit closeout history.",
    );
  validateActivityEvidence(closure, input);
  validateSupersession(closure, input);
  const preparationDigest = digest(prep);
  const submissionDescriptor = activitySubmissionDescriptor(input);
  const submissionDigest = digest(submissionDescriptor);
  const recordId = `learning-record:${digest({ encoding: "academic-os-activity-record/1", candidateId: prep.candidateId, preparationDigest, requestId: input.requestId })}`;
  const closeoutId = `closeout:${digest({ candidateId: prep.candidateId, requestId: input.requestId })}`;
  if (
    old.records.some((r) => r.id === recordId) ||
    history.some((c) => c.id === closeoutId || c.requestId === input.requestId)
  )
    activityRefusal(
      "illegal-transition",
      "duplicate-record-id. The predecessor already contains this request.",
    );
  const preparationEvidenceId = `evidence:activity-preparation:${preparationDigest}`;
  const submissionEvidenceId = `evidence:activity-submission:${submissionDigest}`;
  const descriptor = activityPreparationDescriptor(prep);
  const appendPackets = [
    ...input.evidence.packets,
    {
      id: preparationEvidenceId,
      bytes: freezeBytes(requireActivitySize(descriptor)),
    },
    {
      id: submissionEvidenceId,
      bytes: freezeBytes(requireActivitySize(submissionDescriptor)),
    },
  ];
  const existing = closure.control("evidence");
  const ids = new Set(existing.entries.map((e) => e.id));
  for (const packet of appendPackets) {
    if (ids.has(packet.id))
      activityRefusal(
        "illegal-transition",
        `Duplicate retained evidence identity ${packet.id}.`,
      );
    ids.add(packet.id);
  }
  const exactWrites = parseActivity<ExactWrites>(
    {
      preservedRoles: ["module-identity" as const, ...moduleDataRoles].filter(
        (r) => r !== "evidence" && r !== "learning-records",
      ),
      regions: [
        { role: "learning-records", collection: "records", entryId: recordId },
        {
          role: "learning-records",
          collection: "activityCloseouts",
          entryId: closeoutId,
        },
        ...appendPackets.map((p) => ({
          role: "evidence" as const,
          collection: "entries" as const,
          entryId: p.id,
        })),
        ...appendPackets.map((p) => ({
          role: "retained-inputs" as const,
          collection: "dependencies" as const,
          entryId: p.id,
          path: `.academic-os/retained-inputs/${p.bytes.byteSha256}`,
          byteSha256: p.bytes.byteSha256,
        })),
      ],
    },
    "ExactWrites",
  );
  const binding = recognizeActivityProtocol(closure).binding;
  const unresolved = [...input.evidence.unresolved];
  if (binding.revisionOutput === "native-note-or-verified-reuse")
    unresolved.push(
      "Revision note or source-bound reuse requires an admitted native artifact owner.",
    );
  for (const artifact of input.evidence.artifacts) {
    if (artifact.kind === "parked" || artifact.kind === "unsupported")
      unresolved.push(`${artifact.output}: ${artifact.reason}`);
    if (artifact.kind === "reused-claim")
      unresolved.push(
        `Artifact ${artifact.artifactId} reuse remains an unverified retained claim.`,
      );
  }
  for (const provider of input.evidence.providers)
    if (provider.kind !== "not-requested")
      unresolved.push(
        `${provider.provider} remains unverified by this action.`,
      );
  const uniqueUnresolved = [...new Set(unresolved)];
  const observation = (subject: unknown) => ({
    kind: "deterministic-observation" as const,
    subjectDigest: digest(subject),
    checkerReleaseDigest: prep.releaseDigest,
    result: "pass" as const,
  });
  const logicalResult: LogicalCloseout = {
    requestId: input.requestId,
    recordId,
    preparationId: prep.preparationId,
    scope: "generated-control-evidence-only",
    coverage: input.evidence.coverage,
    understanding: input.evidence.understanding,
    assessment: input.evidence.assessment,
    artifacts: input.evidence.artifacts,
    providers: input.evidence.providers,
    sessionStatus: uniqueUnresolved.length
      ? "parked"
      : input.evidence.coverage.requested === "covered"
        ? "complete"
        : "partial",
    unresolved: uniqueUnresolved,
    checks: {
      "selected-byte-closure": observation(prep.files),
      "procedure-preference-bindings": observation({
        procedure: prep.procedure,
        preferences: prep.preferences,
      }),
      "target-source-scope": observation({
        official: prep.official,
        requested: prep.requested,
        orderedSources: prep.orderedSources,
      }),
      "write-ceiling": observation(exactWrites),
      "evidence-reference-byte-bindings": observation({
        evidence: input.evidence,
        date: input.date,
      }),
      "append-supersession": observation({
        records: old.records,
        closeouts: history,
        supersedes: input.supersedes,
        judgment: input.supersessionJudgment ?? null,
      }),
      "outcome-separation": observation({
        coverage: input.evidence.coverage,
        understanding: input.evidence.understanding,
        assessment: input.evidence.assessment,
        artifacts: input.evidence.artifacts,
        providers: input.evidence.providers,
        unresolved: uniqueUnresolved,
      }),
    },
  };
  const understanding = input.evidence.understanding;
  const first = input.evidence.packets[0];
  const record: LearningRecord = {
    id: recordId,
    kind: "current",
    date: input.date,
    target: prep.official.target,
    coverage:
      input.evidence.coverage.official === "covered"
        ? "requested-target-covered"
        : "partial",
    understanding:
      understanding.kind === "unassessed"
        ? understanding
        : {
            kind: "agent-assessed",
            judgment: understanding.status,
            ownerAttempt: [
              { kind: "evidence", id: understanding.attemptEvidenceId },
            ],
            independentReview: [
              {
                kind: "evidence",
                id: understanding.independentReview.evidenceIds[0],
              },
              ...understanding.independentReview.evidenceIds
                .slice(1)
                .map((id) => ({ kind: "evidence" as const, id })),
            ],
            reasoning: understanding.judgment.reasoning,
            limitations: understanding.judgment.limitations,
          },
    sources: [],
    produced: [],
    assessments:
      input.evidence.assessment.kind === "retained-claim"
        ? [{ kind: "assessment", id: input.evidence.assessment.assessmentId }]
        : [],
    evidence: [
      { kind: "evidence", id: first.id },
      ...input.evidence.packets
        .slice(1)
        .map((p) => ({ kind: "evidence" as const, id: p.id })),
    ],
    supersedes: input.supersedes.map((id) => ({ kind: "learning-record", id })),
  };
  const stored: StoredCloseout = {
    schemaVersion: 1,
    id: closeoutId,
    requestId: input.requestId,
    preparationDigest,
    submissionDigest,
    plannerReleaseDigest: prep.releaseDigest,
    preparationEvidenceId,
    submissionEvidenceId,
    logicalResult,
    official: prep.official,
    requested: prep.requested,
    supersedes: input.supersedes,
    ...(input.supersessionJudgment
      ? { supersessionJudgment: input.supersessionJudgment }
      : {}),
  };
  const records = {
    ...old,
    records: [...old.records, record],
    activityCloseouts: [...history, stored],
  };
  const evidence = {
    ...existing,
    entries: [
      ...existing.entries,
      ...appendPackets.map((packet) =>
        retainedActivityEvidence(packet.id, packet.bytes),
      ),
    ],
  };
  const bundle = {
    ...closure.bundle,
    controls: closure.bundle.controls.map((control) =>
      control.role === "learning-records"
        ? { ...control, bytes: freezeBytes(requireActivitySize(records)) }
        : control.role === "evidence"
          ? { ...control, bytes: freezeBytes(requireActivitySize(evidence)) }
          : control,
    ),
    dependencies: [
      ...closure.bundle.dependencies.filter(
        (d) => d.kind === "retained-original",
      ),
      ...appendPackets.map((packet) => ({
        kind: "retained-original" as const,
        evidenceId: packet.id,
        path: `.academic-os/retained-inputs/${packet.bytes.byteSha256}`,
        bytes: packet.bytes,
      })),
      ...closure.bundle.dependencies.filter(
        (d) => d.kind === "shared-preferences",
      ),
    ],
  };
  return { bundle, logicalResult, exactWrites, stored };
}

export function activityPreparationDescriptor(preparation: Preparation) {
  const { files, ...retained } = preparation;
  return {
    encoding: "academic-os-activity-preparation-descriptor/1",
    preparation: retained,
    filesDigest: digest(files),
  };
}

export function activitySubmissionDescriptor(input: SubmitInput) {
  const { preparation, ...submission } = input;
  return {
    encoding: "academic-os-activity-submission/1",
    preparationDigest: digest(preparation),
    ...submission,
  };
}

function retainedActivityEvidence(
  id: string,
  bytes: ActivityEvidence["packets"][number]["bytes"],
): Evidence {
  return {
    id,
    locator: {
      kind: "retained-original",
      path: `.academic-os/retained-inputs/${bytes.byteSha256}`,
      byteLength: bytes.byteLength,
      byteSha256: bytes.byteSha256,
    },
    citation:
      "Attributed Module activity control evidence; no authenticated academic or Owner authority.",
    content: {
      kind: "known",
      value: bytes.byteSha256,
      evidence: [{ kind: "evidence", id }],
    },
    checked: {
      kind: "unknown",
      reason: "No authenticated observation date asserted.",
      evidence: [],
    },
  };
}
