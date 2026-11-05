import { validateControlTransition } from "../controls/index.js";
import { decodeBundle, generationFiles } from "./bundle.js";
import type { Candidate } from "./candidate.js";
import { digest, freezeBytes, thawBytes } from "./codec.js";
import { refuse } from "./failure.js";
import type {
  ExpectedHead,
  PublicationPlan,
} from "./generated/publication-contract-1.js";
import { resolveExpectedHead } from "./publication-reader.js";
import type { PublicationStore } from "./store.js";

export function freezePlan(
  store: PublicationStore,
  candidate: Candidate,
  input: {
    candidateId: string;
    requestId: string;
    expectedHead: ExpectedHead;
    bundleBytes: Uint8Array;
    releaseDigest: string;
  },
): PublicationPlan {
  const binding = {
    candidateId: input.candidateId,
    requestId: input.requestId,
    expectedHead: input.expectedHead,
    inputBytes: freezeBytes(input.bundleBytes),
    releaseDigest: input.releaseDigest,
    effect: "private-generated-controls/1" as const,
  };
  const prior = store
    .records()
    .find(
      (record): record is PublicationPlan =>
        record.kind === "publication-plan" &&
        record.binding.requestId === input.requestId,
    );
  if (
    store
      .records()
      .some(
        (record) =>
          record.kind === "candidate-reserved" &&
          record.binding.requestId === input.requestId,
      )
  )
    refuse(
      "request-conflict",
      "Request identity belongs to candidate creation.",
    );
  if (prior) {
    if (digest(prior.binding) !== digest(binding))
      refuse("request-conflict", "Publication request identity was rebound.");
    return prior;
  }
  const bundle = decodeBundle(input.bundleBytes, candidate.admission.aggregate);
  const previousHead = resolveExpectedHead(
    store,
    candidate,
    input.expectedHead,
  );
  const previous =
    previousHead.kind === "selected"
      ? store
          .records()
          .find(
            (record): record is PublicationPlan =>
              record.kind === "publication-plan" &&
              record.generationId === previousHead.generationId &&
              record.binding.candidateId === input.candidateId,
          )
      : undefined;
  if (previousHead.kind === "selected" && !previous)
    refuse("unowned-output", "Owned predecessor has no retained plan.");
  const observations = (files: PublicationPlan["files"]) => ({
    moduleCode: candidate.admission.aggregate.moduleCode,
    files: files.map((file) => ({
      kind: "file" as const,
      path: file.path,
      bytes: thawBytes(file.bytes),
    })),
  });
  const issues = validateControlTransition({
    before: previous ? observations(previous.files) : undefined,
    proposed: observations(
      generationFiles(
        bundle,
        candidate.admission.aggregate,
        "transition-validation-only",
      ),
    ),
    request: {
      candidateId: input.candidateId,
      requestId: input.requestId,
      releaseDigest: input.releaseDigest,
    },
  });
  if (issues.length)
    refuse(
      issues.some((issue) => issue.code === "unsupported-effect")
        ? "unsupported-effect"
        : "evidence-mismatch",
      issues.map((issue) => issue.evidence).join(" "),
    );
  const generationId = `generation-${digest({ encoding: "academic-os-publication-request/1", binding, admission: digest(candidate.admission), previousHead })}`;
  const plan: PublicationPlan = {
    schemaVersion: 1,
    kind: "publication-plan",
    encoding: "academic-os-publication-json/1",
    planId: `plan-${digest(binding)}`,
    binding,
    aggregate: candidate.admission.aggregate,
    admissionByteSha256: digest(candidate.admission),
    root: candidate.admission.root.object,
    previousHead,
    generationId,
    files: generationFiles(bundle, candidate.admission.aggregate, generationId),
    nativeArtifactEffects: [],
  };
  store.preflightRecord(plan);
  store.append(plan);
  return plan;
}
