import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import { digest } from "./codec.js";
import { PublicationFailure, refuse } from "./failure.js";
import type {
  RecoveryRequired,
  Refused,
} from "./generated/publication-contract-1.js";
import { loadPublicationNative } from "./native/index.js";
import type {
  ExclusionObservation,
  PublicationNative,
  ValidatedAccountAnchor,
} from "./native-contract.js";
import {
  requirePendingOrder,
  validateMixedHistory,
} from "./native-policy-history.js";
import { publicationRelease, runtimeDirectory } from "./release.js";
import {
  ledgerName,
  namespaceName,
  nativeValue,
  openStore,
  PublicationStore,
} from "./store.js";

export type RuntimeContext = { readonly exclusionPaths: readonly string[] };

async function existingGate(anchorPath: string): Promise<boolean> {
  const journalPath = join(anchorPath, ledgerName);
  const key = createHash("sha256")
    .update(join(anchorPath, ledgerName.toLowerCase()))
    .digest("hex");
  try {
    const ownership = await lstat(join(anchorPath, "journal-ownership"));
    const sidecar = await lstat(
      join(anchorPath, "journal-ownership", `${key}.sqlite`),
    );
    const ledger = await lstat(journalPath);
    const namespace = await lstat(join(anchorPath, namespaceName));
    return (
      ownership.isDirectory() &&
      sidecar.isFile() &&
      ledger.isFile() &&
      namespace.isDirectory()
    );
  } catch {
    return false;
  }
}

export async function withPublicationOwner<T>(input: {
  mutate: boolean;
  bootstrap?: true;
  requestId?: string;
  family?: "host-deployment" | "native-policy";
  prepare?: (
    native: PublicationNative,
    anchor: ValidatedAccountAnchor,
    releaseDigest: string,
  ) => ExclusionObservation;
  validateBeforeSync?: (store: PublicationStore) => void;
  context: RuntimeContext;
  run: (store: PublicationStore, releaseDigest: string) => T;
}): Promise<T | Refused | RecoveryRequired> {
  let native: PublicationNative | undefined;
  let anchor: ReturnType<PublicationNative["resolveAccountAnchor"]> | undefined;
  let entered = false;
  try {
    const binding: PublicationNative = nativeValue(loadPublicationNative());
    native = binding;
    const releaseDigest = await publicationRelease();
    anchor = binding.resolveAccountAnchor();
    const observed = nativeValue(anchor);
    let exclusions = nativeValue(
      binding.observeExclusionRoots({
        anchor: observed,
        requiredRepositoryAndSourcePaths: [
          runtimeDirectory,
          ...input.context.exclusionPaths,
        ].map((path) => Buffer.from(path)),
      }),
    );
    if (input.prepare)
      exclusions = input.prepare(binding, observed, releaseDigest);
    if (!input.bootstrap && !(await existingGate(observed.canonicalAnchorPath)))
      refuse(
        "unknown-candidate",
        "This operation requires an existing publication catalog and gate.",
      );
    const result = await withJournalMutationOwner(
      {
        stateRoot: observed.canonicalAnchorPath,
        journalPath: join(observed.canonicalAnchorPath, ledgerName),
      },
      async () => {
        if (input.prepare)
          exclusions = input.prepare(binding, observed, releaseDigest);
        const interval = input.mutate
          ? nativeValue(binding.beginIntervalUnderHeldGate(observed))
          : null;
        const store = new PublicationStore(
          binding,
          observed,
          exclusions,
          interval,
        );
        entered = true;
        try {
          try {
            openStore(
              store,
              input.bootstrap === true,
              (loaded) => {
                if (input.mutate) requirePendingOrder(loaded, input);
                else validateMixedHistory(loaded);
              },
              input.validateBeforeSync,
            );
            return input.run(store, releaseDigest);
          } finally {
            store.close();
          }
        } catch (error) {
          if (
            error instanceof PublicationFailure &&
            error.result.kind === "recovery-required"
          ) {
            const plan = store
              .records()
              .find(
                (record) =>
                  record.kind === "publication-plan" &&
                  record.binding.requestId === input.requestId,
              );
            throw new PublicationFailure({
              ...error.result,
              requestId: error.result.requestId ?? input.requestId ?? null,
              retainedPlanDigest:
                error.result.retainedPlanDigest ??
                (plan === undefined ? null : digest(plan)),
            });
          }
          throw error;
        }
      },
    );
    if (result.kind === "refused")
      refuse(
        result.reason === "busy" ? "busy" : "unsafe-namespace",
        result.evidence,
      );
    return result.value;
  } catch (error) {
    if (error instanceof PublicationFailure) return error.result;
    return {
      kind: "recovery-required",
      code: "uncertain-publication",
      requestId: null,
      retainedPlanDigest: null,
      evidence: [
        error instanceof Error ? error.message : "Publication failed.",
      ],
    };
  } finally {
    if (!entered && native && anchor?.kind === "ok")
      native.close(anchor.value.directory);
  }
}
