import { decodeBundle, generationFiles } from "./bundle.js";
import type { Candidate } from "./candidate.js";
import { digest, encodePublication, freezeBytes } from "./codec.js";
import { refuse } from "./failure.js";
import type {
  ExpectedHead,
  PublicationPlan,
} from "./generated/publication-contract-1.js";
import { resolveExpectedHead } from "./publication-reader.js";
import type { PublicationStore } from "./store.js";

const planAndReceiptEncodingBudget = 4;
const maximumNewPhysicalClaimBytes = 100_000;
const protocolPhysicalClaimAllowance = 16;
const smallProtocolEventAllowance = 64_000;

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
  const directories = new Set(
    plan.files.flatMap((file) =>
      file.path
        .split("/")
        .slice(0, -1)
        .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
    ),
  );
  store.requireCapacity(
    planAndReceiptEncodingBudget * encodePublication(plan).byteLength +
      (plan.files.length + directories.size + protocolPhysicalClaimAllowance) *
        maximumNewPhysicalClaimBytes +
      smallProtocolEventAllowance,
  );
  store.append(plan);
  return plan;
}
