import { type Candidate, catalogDirectory } from "./candidate.js";
import { digest, thawBytes } from "./codec.js";
import { PublicationFailure, recover, refuse } from "./failure.js";
import type {
  FileClaim,
  PlannedFile,
  PublicationIntent,
  PublicationPlan,
  PublicationReceipt,
} from "./generated/publication-contract-1.js";
import type { DirectoryHandle } from "./native-contract.js";
import {
  completedReceipt,
  currentHead,
  readPlanFiles,
} from "./publication-reader.js";
import { prepareHead, settleIntent } from "./publication-settlement.js";
import { reservePublicationCompletion } from "./generated-completion.js";
import {
  nativeValue,
  type PublicationStore,
  sameLocation,
  sameObject,
} from "./store.js";

export { freezePlan } from "./publication-plan.js";
export {
  completedReceipt,
  currentHead,
  inspectPinned,
} from "./publication-reader.js";
export { pendingIntents, reconcilePending } from "./publication-settlement.js";

function writeTree(
  store: PublicationStore,
  root: DirectoryHandle,
  files: PlannedFile[],
  prefix: string,
  requestId: string,
  attemptId: string,
): void {
  for (const file of files) {
    const relative = file.path.slice(prefix.length);
    const pieces = relative.split("/");
    const name = pieces.pop();
    if (!name) throw new Error("Invalid frozen file path.");
    let parent = root;
    for (const piece of pieces)
      parent = store.directory(parent, piece, requestId, attemptId);
    store.write(parent, name, {
      requestId,
      attemptId,
      path: file.path,
      bytes: thawBytes(file.bytes),
    });
  }
  store.syncDirectory(root);
}

function publishDependencies(
  store: PublicationStore,
  candidate: Candidate,
  plan: PublicationPlan,
): void {
  const staging = catalogDirectory(store, "staging");
  for (const file of plan.files.filter(
    (file) => file.kind === "retained-input",
  )) {
    const name = file.bytes.byteSha256;
    const location = store.location(candidate.retained, name);
    const promotion = store
      .records()
      .find(
        (record) =>
          record.kind === "promotion-observed" &&
          sameLocation(record.to, location),
      );
    if (promotion?.kind === "promotion-observed") {
      const claim = store
        .records()
        .find(
          (record): record is FileClaim =>
            record.kind === "file-claimed" &&
            sameObject(record.file.object, promotion.object),
        );
      if (!claim)
        recover(
          "journal-recovery-required",
          "Dependency promotion lacks a file claim.",
        );
      store.readClaimed(
        candidate.retained,
        name,
        { ...claim.file, location },
        file.bytes,
      );
      continue;
    }
    const stage = store.stagedRegular({
      requestId: plan.binding.requestId,
      staging,
      finalParent: candidate.retained,
      finalName: name,
    });
    const final = nativeValue(
      store.native.observeAt(candidate.retained, store.name(name)),
    );
    let claim = stage.claim.stage;
    if (final.kind === "absent")
      claim = store.write(staging, stage.claim.attemptId, {
        requestId: plan.binding.requestId,
        attemptId: stage.claim.attemptId,
        path: file.path,
        bytes: thawBytes(file.bytes),
      });
    store.promote({
      requestId: plan.binding.requestId,
      attemptId: stage.claim.attemptId,
      sourceParent: staging,
      sourceName: stage.claim.attemptId,
      claim,
      destinationParent: candidate.retained,
      destinationName: name,
    });
  }
}

export function performPublication(
  store: PublicationStore,
  candidate: Candidate,
  plan: PublicationPlan,
): PublicationReceipt {
  const complete = completedReceipt(store, plan);
  if (complete) return complete;
  reservePublicationCompletion(store, plan, false);
  const pending = store
    .records()
    .find(
      (record): record is PublicationIntent =>
        record.kind === "publication-intent" &&
        record.requestId === plan.binding.requestId,
    );
  if (pending) {
    settleIntent(store, pending);
    return pending.receipt;
  }
  if (digest(currentHead(store, candidate)) !== digest(plan.previousHead))
    refuse("stale-head", "Frozen publication expected head is stale.");
  const staging = catalogDirectory(store, "staging");
  const stage = store.stage({
    requestId: plan.binding.requestId,
    purpose: "generation",
    staging,
    finalParent: candidate.generations,
    finalName: plan.generationId,
  });
  const final = nativeValue(
    store.native.observeAt(
      candidate.generations,
      store.name(plan.generationId),
    ),
  );
  if (final.kind === "absent")
    try {
      writeTree(
        store,
        stage.handle,
        plan.files.filter(
          (file) => file.kind === "control" || file.kind === "generation",
        ),
        `.academic-os/control-generations/${plan.generationId}/`,
        plan.binding.requestId,
        stage.claim.attemptId,
      );
    } catch (error) {
      if (
        error instanceof PublicationFailure &&
        error.result.kind === "recovery-required" &&
        error.result.code === "uncertain-claim"
      )
        store.abandonStage(stage.claim);
      throw error;
    }
  const root = store.promote({
    requestId: plan.binding.requestId,
    attemptId: stage.claim.attemptId,
    sourceParent: staging,
    sourceName: stage.claim.attemptId,
    claim: stage.claim.stage,
    destinationParent: candidate.generations,
    destinationName: plan.generationId,
  });
  publishDependencies(store, candidate, plan);
  readPlanFiles(store, candidate, plan);
  const intent = prepareHead(store, candidate, plan, root);
  settleIntent(store, intent);
  return intent.receipt;
}
