import {
  decodeBundle,
  decodeIdentity,
  generationFiles,
  moduleAggregate,
} from "./bundle.js";
import {
  bootstrapCatalog,
  completedCandidate,
  createCandidate,
  openCandidate,
  recoverPendingCreates,
  summary,
} from "./candidate.js";
import { freezeBytes, thawBytes } from "./codec.js";
import { PublicationFailure, recover } from "./failure.js";
import type {
  CreateResult,
  CreateWireInput,
  InspectResult,
  InspectWireInput,
  PublicationPlan,
  PublishResult,
  PublishWireInput,
  Readiness,
} from "./generated/publication-contract-1.js";
import { requireInputBytes } from "./limits.js";
import { type RuntimeContext, withPublicationOwner } from "./owner.js";
import {
  completedReceipt,
  currentHead,
  freezePlan,
  inspectPinned,
  pendingIntents,
  performPublication,
  reconcilePending,
} from "./publication.js";
import {
  parseBytes,
  validateBundle,
  validateCreateInput,
  validateInspectInput,
  validatePublishInput,
} from "./schema.js";

export type { CreateResult, InspectResult, PublishResult };
export type CreateInput = Omit<CreateWireInput, "identityBytesBase64"> & {
  readonly identityBytes: Uint8Array;
};
export type PublishInput = Omit<PublishWireInput, "inputBytesBase64"> & {
  readonly bundleBytes: Uint8Array;
};
export type InspectInput = InspectWireInput;

export const readiness: Readiness = {
  publication: "host-owned-generated-candidates-only",
  workflows: "not-implemented",
  moduleConformance: "not-implemented",
  migration: "not-implemented",
};

export function createPublicationService(
  context: RuntimeContext = { exclusionPaths: [] },
) {
  return {
    async create(input: CreateInput): Promise<CreateResult> {
      try {
        requireInputBytes(input.identityBytes);
        if (
          !validateCreateInput({
            requestId: input.requestId,
            identityBytesBase64: freezeBytes(input.identityBytes).bytesBase64,
          })
        )
          throw new Error("Invalid create input.");
        decodeIdentity(input.identityBytes);
      } catch (error) {
        return invalid(error);
      }
      return withPublicationOwner<CreateResult>({
        mutate: true,
        bootstrap: true,
        requestId: input.requestId,
        requestKind: "candidate-reserved",
        context,
        completed(store, releaseDigest) {
          const admission = completedCandidate(store, {
            ...input,
            releaseDigest,
          });
          return admission
            ? { kind: "created", candidate: summary(admission) }
            : undefined;
        },
        run: (store, releaseDigest) => {
          bootstrapCatalog(store);
          reconcilePending(store, releaseDigest);
          recoverPendingCreates(store, releaseDigest);
          return {
            kind: "created",
            candidate: summary(
              createCandidate(store, { ...input, releaseDigest }),
            ),
          };
        },
      });
    },
    async publish(input: PublishInput): Promise<PublishResult> {
      try {
        requireInputBytes(input.bundleBytes);
        if (
          !validatePublishInput({
            candidateId: input.candidateId,
            requestId: input.requestId,
            expectedHead: input.expectedHead,
            inputBytesBase64: freezeBytes(input.bundleBytes).bytesBase64,
          })
        )
          return invalid(new Error("Invalid publish input."));
        const raw = parseBytes(input.bundleBytes, validateBundle);
        const identity = raw.controls.find(
          (control) => control.role === "module-identity",
        );
        if (!identity)
          throw new Error("Complete generation lacks module identity.");
        const aggregate = moduleAggregate(
          decodeIdentity(Buffer.from(identity.bytes.bytesBase64, "base64")),
        );
        generationFiles(
          decodeBundle(input.bundleBytes, aggregate),
          aggregate,
          "validation-only",
        );
      } catch (error) {
        return invalid(error);
      }
      return withPublicationOwner<PublishResult>({
        mutate: true,
        requestId: input.requestId,
        requestKind: "publication-plan",
        context,
        completed(store, releaseDigest) {
          if (
            !store
              .records()
              .some(
                (record) =>
                  record.kind === "settled" &&
                  record.requestId === input.requestId,
              )
          )
            return undefined;
          const candidate = openCandidate(store, input.candidateId);
          const plan = freezePlan(store, candidate, {
            ...input,
            releaseDigest,
          });
          const receipt = completedReceipt(store, plan);
          if (!receipt)
            recover(
              "journal-recovery-required",
              "Completed publication receipt is unavailable.",
            );
          inspectPinned(store, candidate, plan.generationId);
          return {
            kind: "published",
            receipt,
            replayed: true,
            currentHead: currentHead(store, candidate),
          };
        },
        run: (store, releaseDigest) => {
          reconcilePending(store, releaseDigest);
          recoverPendingCreates(store, releaseDigest);
          const candidate = openCandidate(store, input.candidateId);
          let plan: PublicationPlan;
          try {
            plan = freezePlan(store, candidate, { ...input, releaseDigest });
          } catch (error) {
            if (error instanceof PublicationFailure) throw error;
            return invalid(error);
          }
          const replayed = completedReceipt(store, plan) !== undefined;
          const receipt = performPublication(store, candidate, plan);
          return {
            kind: "published",
            receipt,
            replayed,
            currentHead: currentHead(store, candidate),
          };
        },
      });
    },
    async inspect(input: InspectInput): Promise<InspectResult> {
      if (!validateInspectInput(input))
        return invalid(new Error("Invalid inspect input."));
      return withPublicationOwner<InspectResult>({
        mutate: false,
        context,
        run: (store) => {
          if (pendingIntents(store).length)
            recover(
              "uncertain-publication",
              "A pending publication requires a mutating recovery before inspection.",
            );
          const candidate = openCandidate(store, input.candidateId);
          const current = currentHead(store, candidate);
          if (current.kind === "absent" && input.selection.kind === "current")
            return {
              kind: "empty",
              candidate: summary(candidate.admission),
              readiness,
            };
          const generationId =
            input.selection.kind === "pinned"
              ? input.selection.generationId
              : current.kind === "selected"
                ? current.generationId
                : "";
          const pinned = inspectPinned(store, candidate, generationId);
          return {
            kind: "inspected",
            candidate: summary(candidate.admission),
            selection: pinned.selection,
            currentHead: current,
            files: pinned.files,
            coverage: "validated-module-data",
            readiness,
          };
        },
      });
    },
  };
}

function invalid(error: unknown): {
  kind: "refused";
  code: "invalid-controls";
  evidence: string[];
} {
  return {
    kind: "refused",
    code: "invalid-controls",
    evidence: [error instanceof Error ? error.message : "Invalid controls."],
  };
}

export const createGeneratedCandidate = (
  input: CreateInput,
): Promise<CreateResult> => createPublicationService().create(input);
export const publishGeneratedControls = (
  input: PublishInput,
): Promise<PublishResult> => createPublicationService().publish(input);
export const inspectGeneratedCandidate = (
  input: InspectInput,
): Promise<InspectResult> => createPublicationService().inspect(input);

export type {
  ModuleAggregate,
  PublicationBundle,
} from "./generated/publication-contract-1.js";
export function validateGeneratedBundle(input: {
  bundleBytes: Uint8Array;
  aggregate: import("./generated/publication-contract-1.js").ModuleAggregate;
}) {
  try {
    const bundle = decodeBundle(input.bundleBytes, input.aggregate);
    const files = generationFiles(
      bundle,
      input.aggregate,
      "activity-validation-only",
    );
    return {
      kind: "validated" as const,
      bundle,
      files: files.map((file) => ({
        kind: "file" as const,
        path: file.path,
        bytes: thawBytes(file.bytes),
      })),
    };
  } catch (error) {
    return invalid(error);
  }
}
