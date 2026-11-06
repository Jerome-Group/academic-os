import type {
  Judgment,
  SubmitInput,
} from "../module-activity/generated/workflow.js";
import type { ActivityClosure } from "./activity-closure.js";
import { activityRefusal } from "./activity-failure.js";
import { activityBytes } from "./activity-packets.js";
import {
  activitySupersessionSubject,
  checkActivityJudgment,
  extensionActivityMember,
  recognizeActivityProtocol,
} from "./activity-preparation.js";
import { digest } from "./canonical-json.js";

export function validateActivityEvidence(
  closure: ActivityClosure,
  input: SubmitInput,
): void {
  const { preparation: prep, evidence } = input;
  const packets = evidence.packets;
  for (const packet of packets) activityBytes(packet.bytes);
  if (new Set(packets.map((p) => p.id)).size !== packets.length)
    activityRefusal("evidence-mismatch", "Repeated evidence packet identity.");
  const refs = (ids: readonly string[]) => {
    for (const id of ids)
      if (!packets.some((p) => p.id === id)) closure.evidenceBytes(id);
  };
  const judgment = (value: Judgment, kind: Judgment["kind"], subject: string) =>
    checkActivityJudgment(closure, value, kind, subject, packets);
  const membership = prep.official.membership;
  if (membership.kind !== "declared")
    activityRefusal(
      "scope-ambiguous",
      "Opaque official membership cannot receive whole coverage.",
      "needs-judgment",
    );
  const official = membership.orderedMembers;
  const requested =
    prep.requested.kind === "selection"
      ? prep.requested.members
      : [
          ...official,
          ...(prep.requested.kind === "extension"
            ? prep.requested.additional.map(extensionActivityMember)
            : []),
        ];
  const covered = new Set(evidence.coverage.coveredMembers);
  if (
    covered.size !== evidence.coverage.coveredMembers.length ||
    [...covered].some((id) => ![...official, ...requested].includes(id))
  )
    activityRefusal(
      "evidence-mismatch",
      "Coverage has foreign or repeated members.",
    );
  const officialStatus = official.every((id) => covered.has(id))
    ? "covered"
    : "partial";
  const count = requested.filter((id) => covered.has(id)).length;
  const requestedStatus =
    count === requested.length ? "covered" : count ? "partial" : "none";
  if (
    evidence.coverage.official !== officialStatus ||
    evidence.coverage.requested !== requestedStatus
  )
    activityRefusal(
      "evidence-mismatch",
      "coverage-scope-mismatch. Requested and official coverage are recomputed independently.",
    );
  judgment(
    evidence.coverage.judgment,
    "coverage",
    digest({
      preparationDigest: digest(prep),
      coveredMembers: evidence.coverage.coveredMembers,
    }),
  );
  if (
    !packets.some(
      (p) =>
        p.role === "coverage-account" &&
        evidence.coverage.judgment.evidenceIds.includes(p.id),
    )
  )
    activityRefusal(
      "evidence-mismatch",
      "Coverage needs exact retained coverage-account bytes.",
    );
  const u = evidence.understanding;
  if (u.kind === "agent-assessed") {
    const attempt = packets.find(
      (p) => p.id === u.attemptEvidenceId && p.role === "owner-attempt-claim",
    );
    const review = packets.find(
      (p) =>
        p.role === "independent-review-claim" &&
        u.independentReview.evidenceIds.includes(p.id),
    );
    if (
      !attempt ||
      !review ||
      u.judgment.author === u.independentReview.author ||
      u.scope.some((id) => !requested.includes(id)) ||
      new Set(u.scope).size !== u.scope.length
    )
      activityRefusal(
        "evidence-mismatch",
        "understanding-evidence-missing. Exact attempt, source-bound scope and distinct attributed review are required; author strings do not authenticate independence.",
      );
    const subject = digest({
      preparationDigest: digest(prep),
      scope: u.scope,
      attemptByteSha256: attempt.bytes.byteSha256,
    });
    judgment(u.judgment, "unaided-understanding", subject);
    judgment(u.independentReview, "unaided-understanding", subject);
    if (!u.judgment.evidenceIds.includes(attempt.id))
      activityRefusal(
        "evidence-mismatch",
        "Understanding judgment omits its exact attempt.",
      );
  }
  if (evidence.assessment.kind === "retained-claim") {
    const assessmentId = evidence.assessment.assessmentId;
    if (
      !closure
        .control("learning-records")
        .assessments.some((a) => a.id === assessmentId)
    )
      activityRefusal(
        "evidence-mismatch",
        "Retained assessment identity is missing.",
      );
    refs(evidence.assessment.evidenceIds);
  }
  for (const artifact of evidence.artifacts) {
    if (artifact.kind === "not-required")
      judgment(
        artifact.judgment,
        "artifact-not-required",
        digest({
          preparationDigest: digest(prep),
          output: "revision-note-or-reference",
        }),
      );
    if (artifact.kind === "reused-claim")
      judgment(
        artifact.judgment,
        "artifact-reuse",
        digest({
          preparationDigest: digest(prep),
          artifactId: artifact.artifactId,
          contentSha256: artifact.contentSha256,
        }),
      );
    if (artifact.kind === "parked") refs(artifact.retainedSourceEvidenceIds);
  }
  if (
    !evidence.artifacts.length &&
    recognizeActivityProtocol(closure).binding.revisionOutput === "not-required"
  )
    activityRefusal(
      "missing-prerequisite",
      "Synthetic no-output activity requires an explicit not-required disposition with retained judgment.",
    );
  for (const provider of evidence.providers)
    if (provider.kind === "retained-verification-claim")
      refs(provider.evidenceIds);
  const date = input.date;
  if (date.kind === "disputed")
    for (const alternative of date.alternatives)
      refs(alternative.evidence.map((e) => e.id));
  else refs(date.evidence.map((e) => e.id));
}

export function validateSupersession(
  closure: ActivityClosure,
  input: SubmitInput,
): void {
  const records = closure.control("learning-records").records;
  if (new Set(input.supersedes).size !== input.supersedes.length)
    activityRefusal("illegal-transition", "Repeated supersession edge.");
  const inactive = new Set(
    records.flatMap((r) => r.supersedes.map((ref) => ref.id)),
  );
  const target = input.preparation.official.target;
  for (const id of input.supersedes) {
    const record = records.find((r) => r.id === id);
    if (!record || inactive.has(id))
      activityRefusal(
        "foreign-supersession",
        "Supersession requires an existing active predecessor.",
      );
    if (
      record.kind !== "current" ||
      record.target.kind !== "revision" ||
      target.kind !== "revision" ||
      record.target.unit.id !== target.unit.id ||
      (record.coverage !== "requested-target-covered" &&
        !closure
          .control("learning-records")
          .activityCloseouts?.some(
            (c) => c.logicalResult.recordId === record.id,
          ))
    )
      activityRefusal(
        "illegal-transition",
        "Supersession cannot erase unknown, incompatible or uncovered predecessor scope.",
      );
    const closeout = closure
      .control("learning-records")
      .activityCloseouts?.find((c) => c.logicalResult.recordId === record.id);
    const priorCovered = closeout
      ? closeout.logicalResult.coverage.coveredMembers
      : record.target.topics.map((t) => t.id);
    if (
      priorCovered.some(
        (id) => !input.evidence.coverage.coveredMembers.includes(id),
      )
    )
      activityRefusal(
        "illegal-transition",
        "Supersession cannot erase uncovered predecessor scope.",
      );
  }
  if (input.supersedes.length) {
    if (!input.supersessionJudgment)
      activityRefusal(
        "missing-prerequisite",
        "Supersession requires its attributed reason.",
      );
    checkActivityJudgment(
      closure,
      input.supersessionJudgment,
      "supersession",
      activitySupersessionSubject(
        records,
        input.supersedes,
        input.preparation.official,
      ),
      input.evidence.packets,
    );
  } else if (input.supersessionJudgment)
    activityRefusal(
      "illegal-transition",
      "Supersession judgment has no predecessor edges.",
    );
}
