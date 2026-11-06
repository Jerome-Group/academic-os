import { validateCompleteFiles } from "./bundle.js";
import {
  type Candidate,
  catalogDirectory,
  revalidateCandidate,
} from "./candidate.js";
import { recover, refuse } from "./failure.js";
import type {
  ExpectedHead,
  FileClaim,
  OwnedHead,
  PlannedFile,
  PublicationIntent,
  PublicationPlan,
  PublicationReceipt,
  SelectedHead,
  Settlement,
} from "./generated/publication-contract-1.js";
import {
  nativeValue,
  type PublicationStore,
  sameLocation,
  sameObject,
} from "./store.js";

export function planFor(
  store: PublicationStore,
  requestId: string,
): PublicationPlan {
  const plan = store
    .records()
    .find(
      (record): record is PublicationPlan =>
        record.kind === "publication-plan" &&
        record.binding.requestId === requestId,
    );
  if (!plan)
    recover(
      "journal-recovery-required",
      "Publication intent lacks its exact plan.",
      requestId,
    );
  return plan;
}

export function readPlanFiles(
  store: PublicationStore,
  candidate: Candidate,
  plan: PublicationPlan,
): void {
  for (const file of plan.files) {
    if (file.kind === "head") continue;
    const pieces = file.path.split("/");
    const name = pieces.pop();
    if (name === undefined) throw new Error("Empty frozen path.");
    let parent = candidate.root;
    for (const piece of pieces) {
      let claim = store.directoryClaim(parent, piece);
      if (!claim) {
        const location = store.location(parent, piece);
        const stage = store
          .records()
          .find(
            (record) =>
              record.kind === "stage-claimed" &&
              record.requestId === plan.binding.requestId &&
              sameLocation(record.finalLocation, location) &&
              !store
                .records()
                .some(
                  (other) =>
                    other.kind === "orphan-attempt" &&
                    other.attemptId === record.attemptId,
                ),
          );
        if (stage?.kind === "stage-claimed")
          claim = { ...stage.stage, location };
      }
      if (!claim)
        refuse(
          "root-replaced",
          "Generation path lacks a durable directory claim.",
        );
      parent = store.openDirectory(parent, piece, claim);
    }
    const location = store.location(parent, name);
    let claim = store
      .records()
      .find(
        (record): record is FileClaim =>
          record.kind === "file-claimed" &&
          sameLocation(record.file.location, location),
      )?.file;
    if (!claim && file.kind === "retained-input") {
      const promotion = store
        .records()
        .find(
          (record) =>
            record.kind === "promotion-observed" &&
            sameLocation(record.to, location),
        );
      const original =
        promotion?.kind === "promotion-observed"
          ? store
              .records()
              .find(
                (record): record is FileClaim =>
                  record.kind === "file-claimed" &&
                  sameObject(record.file.object, promotion.object),
              )
          : undefined;
      if (original && promotion?.kind === "promotion-observed")
        claim = { ...original.file, location: promotion.to };
    }
    if (!claim)
      refuse("unowned-output", "Selected file has no physical claim.");
    store.readClaimed(parent, name, claim, file.bytes);
  }
  validateCompleteFiles(plan.files, plan.aggregate);
}

export function currentHead(
  store: PublicationStore,
  candidate: Candidate,
): OwnedHead {
  revalidateCandidate(store, candidate);
  const entry = nativeValue(
    store.native.observeAt(candidate.admin, store.name("00 Module.json")),
  );
  if (entry.kind === "absent") return { kind: "absent" };
  const heads = store
    .records()
    .filter(
      (record): record is PublicationIntent =>
        record.kind === "publication-intent" &&
        record.receipt.candidateId === candidate.admission.candidateId &&
        sameObject(
          record.receipt.selectedHead.headClaim.object,
          entry.observation.object,
        ),
    );
  const intent = heads.at(-1);
  if (!intent)
    refuse(
      "unowned-output",
      "Current selector lacks its claimed publication intent.",
    );
  const selected = intent.receipt.selectedHead;
  store.readClaimed(
    candidate.admin,
    "00 Module.json",
    selected.headClaim,
    selected.head,
  );
  readPlanFiles(store, candidate, planFor(store, intent.requestId));
  return selected;
}

export function resolveExpectedHead(
  store: PublicationStore,
  candidate: Candidate,
  expected: ExpectedHead,
): OwnedHead {
  const current = currentHead(store, candidate);
  if (
    expected.kind === "absent"
      ? current.kind !== "absent"
      : current.kind !== "selected" ||
        current.head.byteSha256 !== expected.headByteSha256
  )
    refuse(
      "stale-head",
      "Expected selector differs from its current owned bytes.",
    );
  return current;
}

export function completedReceipt(
  store: PublicationStore,
  plan: PublicationPlan,
): PublicationReceipt | undefined {
  const settlement = store
    .records()
    .find(
      (record): record is Settlement =>
        record.kind === "settled" &&
        record.requestId === plan.binding.requestId,
    );
  if (!settlement) return undefined;
  const intent = store
    .records()
    .find(
      (record): record is PublicationIntent =>
        record.kind === "publication-intent" &&
        record.requestId === plan.binding.requestId,
    );
  if (!intent)
    recover(
      "journal-recovery-required",
      "Settlement lacks its receipt.",
      plan.binding.requestId,
    );
  const receipts = catalogDirectory(store, "receipts");
  store.readClaimed(
    receipts,
    `${intent.receipt.receiptId}.json`,
    settlement.receipt,
    intent.pendingReceipt,
  );
  return intent.receipt;
}

export function inspectPinned(
  store: PublicationStore,
  candidate: Candidate,
  generationId: string,
): { selection: SelectedHead; files: PlannedFile[] } {
  const intent = store
    .records()
    .find(
      (record): record is PublicationIntent =>
        record.kind === "publication-intent" &&
        record.receipt.candidateId === candidate.admission.candidateId &&
        record.receipt.selectedHead.generationId === generationId &&
        store
          .records()
          .some(
            (other) =>
              other.kind === "settled" && other.requestId === record.requestId,
          ),
    );
  if (!intent)
    refuse("unknown-candidate", "No settled generation exists for this pin.");
  const plan = planFor(store, intent.requestId);
  readPlanFiles(store, candidate, plan);
  completedReceipt(store, plan);
  return { selection: intent.receipt.selectedHead, files: plan.files };
}
