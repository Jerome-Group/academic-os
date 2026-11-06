import { decodeIdentity, moduleAggregate } from "./bundle.js";
import { digest, freezeBytes, thawBytes } from "./codec.js";
import { PublicationFailure, recover, refuse } from "./failure.js";
import type {
  CandidateReservation,
  GeneratedCandidateAdmission,
  ModuleAggregate,
} from "./generated/publication-contract-1.js";
import { requireInputBytes } from "./limits.js";
import type { DirectoryHandle } from "./native-contract.js";
import { nativeValue, type PublicationStore, sameObject } from "./store.js";

export type Candidate = {
  admission: GeneratedCandidateAdmission;
  root: DirectoryHandle;
  admin: DirectoryHandle;
  internal: DirectoryHandle;
  generations: DirectoryHandle;
  retained: DirectoryHandle;
};

function requiredDirectory(
  store: PublicationStore,
  parent: DirectoryHandle,
  name: string,
): DirectoryHandle {
  const claim = store.directoryClaim(parent, name);
  if (!claim) refuse("root-replaced", `Missing directory claim for ${name}.`);
  return store.openDirectory(parent, name, claim);
}

export function catalogDirectory(
  store: PublicationStore,
  name: string,
): DirectoryHandle {
  return requiredDirectory(store, store.namespace, name);
}

export function openCandidate(
  store: PublicationStore,
  candidateId: string,
): Candidate {
  store.guard();
  const admission = store
    .records()
    .find(
      (record): record is GeneratedCandidateAdmission =>
        record.kind === "generated-candidate-admitted" &&
        record.candidateId === candidateId,
    );
  if (!admission)
    refuse(
      "unknown-candidate",
      "No generated admission exists for this candidate.",
    );
  const candidates = catalogDirectory(store, "candidates");
  const root = store.openDirectory(candidates, candidateId, admission.root);
  const admin = requiredDirectory(store, root, "00 Module Admin");
  const internal = requiredDirectory(store, root, ".academic-os");
  return {
    admission,
    root,
    admin,
    internal,
    generations: requiredDirectory(store, internal, "control-generations"),
    retained: requiredDirectory(store, internal, "retained-inputs"),
  };
}

export function bootstrapCatalog(store: PublicationStore): void {
  for (const name of ["staging", "candidates", "requests", "receipts"])
    store.directory(store.namespace, name, "bootstrap", "bootstrap");
}

export function completedCandidate(
  store: PublicationStore,
  input: {
    requestId: string;
    identityBytes: Uint8Array;
    releaseDigest: string;
  },
): GeneratedCandidateAdmission | undefined {
  const reservation = store
    .records()
    .find(
      (record): record is CandidateReservation =>
        record.kind === "candidate-reserved" &&
        record.binding.requestId === input.requestId,
    );
  if (!reservation) return undefined;
  const binding = {
    requestId: input.requestId,
    identityBytes: freezeBytes(input.identityBytes),
    releaseDigest: input.releaseDigest,
    effect: "private-generated-controls/1" as const,
  };
  if (digest(reservation.binding) !== digest(binding))
    refuse("request-conflict", "Create request identity was rebound.");
  const admitted = store
    .records()
    .find(
      (record): record is GeneratedCandidateAdmission =>
        record.kind === "generated-candidate-admitted" &&
        record.candidateId === reservation.candidateId,
    );
  if (!admitted) return undefined;
  if (admitted.createBindingDigest !== digest(binding))
    recover(
      "journal-recovery-required",
      "Completed candidate binding differs from its reservation.",
    );
  openCandidate(store, admitted.candidateId);
  return admitted;
}

export function createCandidate(
  store: PublicationStore,
  input: {
    requestId: string;
    identityBytes: Uint8Array;
    releaseDigest: string;
  },
): GeneratedCandidateAdmission {
  requireInputBytes(input.identityBytes);
  const identity = decodeIdentity(input.identityBytes);
  const aggregate = moduleAggregate(identity);
  const binding = {
    requestId: input.requestId,
    identityBytes: freezeBytes(input.identityBytes),
    releaseDigest: input.releaseDigest,
    effect: "private-generated-controls/1" as const,
  };
  const bindingDigest = digest(binding);
  const candidateId = `candidate-${bindingDigest}`;
  const existing = store
    .records()
    .find(
      (record): record is CandidateReservation =>
        record.kind === "candidate-reserved" &&
        record.binding.requestId === input.requestId,
    );
  if (
    store
      .records()
      .some(
        (record) =>
          record.kind === "publication-plan" &&
          record.binding.requestId === input.requestId,
      )
  )
    refuse(
      "request-conflict",
      "Request identity already belongs to a publication.",
    );
  if (existing && digest(existing.binding) !== bindingDigest)
    refuse("request-conflict", "Create request identity was rebound.");
  const admitted = store
    .records()
    .find(
      (record): record is GeneratedCandidateAdmission =>
        record.kind === "generated-candidate-admitted" &&
        record.candidateId === candidateId,
    );
  if (admitted) {
    openCandidate(store, candidateId);
    return admitted;
  }
  const candidates = catalogDirectory(store, "candidates");
  const staging = catalogDirectory(store, "staging");
  if (!existing) {
    const reservation: CandidateReservation = {
      schemaVersion: 1,
      kind: "candidate-reserved",
      candidateId,
      binding,
      aggregate,
      target: store.location(candidates, candidateId),
    };
    store.preflightRecord(reservation);
    store.append(reservation);
  }
  const stage = store.stage({
    requestId: input.requestId,
    purpose: "candidate",
    staging,
    finalParent: candidates,
    finalName: candidateId,
  });
  try {
    const admin = store.directory(
      stage.handle,
      "00 Module Admin",
      input.requestId,
      stage.claim.attemptId,
    );
    const internal = store.directory(
      stage.handle,
      ".academic-os",
      input.requestId,
      stage.claim.attemptId,
    );
    store.directory(
      internal,
      "control-generations",
      input.requestId,
      stage.claim.attemptId,
    );
    store.directory(
      internal,
      "retained-inputs",
      input.requestId,
      stage.claim.attemptId,
    );
    store.syncDirectory(admin);
    store.syncDirectory(internal);
    store.syncDirectory(stage.handle);
  } catch (error) {
    if (
      error instanceof PublicationFailure &&
      error.result.kind === "recovery-required" &&
      error.result.code === "uncertain-claim" &&
      nativeValue(store.native.observeAt(candidates, store.name(candidateId)))
        .kind === "absent"
    ) {
      store.abandonStage(stage.claim);
      return createCandidate(store, input);
    }
    throw error;
  }
  const root = store.promote({
    requestId: input.requestId,
    attemptId: stage.claim.attemptId,
    sourceParent: staging,
    sourceName: stage.claim.attemptId,
    claim: stage.claim.stage,
    destinationParent: candidates,
    destinationName: candidateId,
  });
  const admission: GeneratedCandidateAdmission = {
    schemaVersion: 1,
    kind: "generated-candidate-admitted",
    candidateId,
    createBindingDigest: bindingDigest,
    aggregate,
    root,
    policy: "generated-publication/1",
    effect: "private-generated-controls/1",
    releaseDigest: input.releaseDigest,
  };
  store.append(admission);
  return admission;
}

export function revalidateCandidate(
  store: PublicationStore,
  candidate: Candidate,
): void {
  store.guard();
  const candidates = catalogDirectory(store, "candidates");
  store.requireClaim(
    candidates,
    candidate.admission.candidateId,
    candidate.admission.root,
  );
  if (
    !sameObject(
      store.observation(candidate.root).object,
      candidate.admission.root.object,
    )
  )
    refuse("root-replaced", "Pinned candidate root changed.");
}

export function recoverPendingCreates(
  store: PublicationStore,
  releaseDigest: string,
): void {
  const admitted = new Set(
    store
      .records()
      .flatMap((record) =>
        record.kind === "generated-candidate-admitted"
          ? [record.candidateId]
          : [],
      ),
  );
  for (const record of store.records()) {
    if (
      record.kind !== "candidate-reserved" ||
      admitted.has(record.candidateId)
    )
      continue;
    if (record.binding.releaseDigest !== releaseDigest)
      recover(
        "uncertain-claim",
        "Pending creation belongs to a different release.",
        record.binding.requestId,
      );
    const candidate = createCandidate(store, {
      requestId: record.binding.requestId,
      identityBytes: thawBytes(record.binding.identityBytes),
      releaseDigest: record.binding.releaseDigest,
    });
    admitted.add(candidate.candidateId);
  }
}

export function summary(candidate: GeneratedCandidateAdmission): {
  candidateId: string;
  aggregate: ModuleAggregate;
  effect: "private-generated-controls/1";
} {
  return {
    candidateId: candidate.candidateId,
    aggregate: candidate.aggregate,
    effect: candidate.effect,
  };
}
