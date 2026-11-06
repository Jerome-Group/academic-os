import {
  type Candidate,
  catalogDirectory,
  openCandidate,
  revalidateCandidate,
} from "./candidate.js";
import {
  digest,
  encodePublication,
  freezeBytes,
  sha256,
  thawBytes,
} from "./codec.js";
import { maximumReceiptBytes } from "./event-envelope.js";
import { requireFileBytes } from "./limits.js";
import { recover, refuse } from "./failure.js";
import type {
  HeadReady,
  PhysicalClaim,
  PlannedFile,
  PublicationIntent,
  PublicationPlan,
  PublicationReceipt,
  ReceiptReady,
  SelectedHead,
} from "./generated/publication-contract-1.js";
import { currentHead, planFor, readPlanFiles } from "./publication-reader.js";
import { reservePublicationCompletion } from "./generated-completion.js";
import {
  nativeEffect,
  nativeValue,
  type PublicationStore,
  sameObject,
} from "./store.js";

function headFile(plan: PublicationPlan): PlannedFile {
  const file = plan.files.find((file) => file.kind === "head");
  if (!file)
    recover(
      "journal-recovery-required",
      "Frozen plan lacks a head.",
      plan.binding.requestId,
      digest(plan),
    );
  return file;
}

export function prepareHead(
  store: PublicationStore,
  candidate: Candidate,
  plan: PublicationPlan,
  generationRoot: PhysicalClaim,
): PublicationIntent {
  const existing = store
    .records()
    .find(
      (record): record is PublicationIntent =>
        record.kind === "publication-intent" &&
        record.requestId === plan.binding.requestId,
    );
  if (existing) return existing;
  const file = headFile(plan);
  let ready = store
    .records()
    .find(
      (record): record is HeadReady =>
        record.kind === "head-ready" &&
        record.requestId === plan.binding.requestId,
    );
  if (!ready) {
    const temporary = store.temporary(
      candidate.admin,
      "head",
      plan.binding.requestId,
      file.bytes,
    );
    ready = {
      schemaVersion: 1,
      kind: "head-ready",
      requestId: plan.binding.requestId,
      planDigest: digest(plan),
      temporary,
      finalLocation: store.location(candidate.admin, "00 Module.json"),
      bytes: file.bytes,
      expected: plan.previousHead,
    };
    store.append(ready);
  }
  const manifest = plan.files.find((file) => file.kind === "generation");
  if (!manifest) throw new Error("Plan lacks a generation manifest.");
  const selected: SelectedHead = {
    kind: "selected",
    head: file.bytes,
    headClaim: { ...ready.temporary, location: ready.finalLocation },
    generationId: plan.generationId,
    generationManifest: {
      byteLength: manifest.bytes.byteLength,
      byteSha256: manifest.bytes.byteSha256,
    },
    generationRoot,
  };
  const receipt: PublicationReceipt = {
    schemaVersion: 1,
    kind: "publication-receipt",
    receiptId: `receipt-${digest(plan)}`,
    requestId: plan.binding.requestId,
    candidateId: candidate.admission.candidateId,
    planDigest: digest(plan),
    bindingDigest: digest(plan.binding),
    previousHead: plan.previousHead,
    selectedHead: selected,
    manifest: plan.files,
    effect: "private-generated-controls/1",
  };
  const intent: PublicationIntent = {
    schemaVersion: 1,
    kind: "publication-intent",
    requestId: plan.binding.requestId,
    planDigest: digest(plan),
    headReady: ready,
    pendingReceipt: freezeBytes(encodePublication(receipt)),
    receipt,
  };
  store.preflightRecord(intent);
  requireFileBytes(intent.pendingReceipt.byteLength);
  if (intent.pendingReceipt.byteLength > maximumReceiptBytes())
    refuse(
      "invalid-controls",
      "Pending receipt exceeds the admitted intent envelope.",
    );
  store.append(intent);
  return intent;
}

function settleReceipt(
  store: PublicationStore,
  intent: PublicationIntent,
): void {
  const receipts = catalogDirectory(store, "receipts");
  let ready = store
    .records()
    .find(
      (record): record is ReceiptReady =>
        record.kind === "receipt-ready" &&
        record.requestId === intent.requestId,
    );
  if (!ready) {
    const temporary = store.temporary(
      receipts,
      "receipt",
      intent.requestId,
      intent.pendingReceipt,
    );
    ready = {
      schemaVersion: 1,
      kind: "receipt-ready",
      requestId: intent.requestId,
      receiptId: intent.receipt.receiptId,
      temporary,
      finalLocation: store.location(
        receipts,
        `${intent.receipt.receiptId}.json`,
      ),
      bytes: intent.pendingReceipt,
    };
    store.append(ready);
  }
  const temporaryName = Buffer.from(
    ready.temporary.location.rawNameBase64,
    "base64",
  ).toString("utf8");
  const finalName = `${ready.receiptId}.json`;
  const claim = store.promote({
    requestId: intent.requestId,
    attemptId: ready.receiptId,
    sourceParent: receipts,
    sourceName: temporaryName,
    claim: ready.temporary,
    destinationParent: receipts,
    destinationName: finalName,
  });
  store.readClaimed(receipts, finalName, claim, intent.pendingReceipt);
  if (
    !store
      .records()
      .some(
        (record) =>
          record.kind === "settled" && record.requestId === intent.requestId,
      )
  )
    store.append({
      schemaVersion: 1,
      kind: "settled",
      requestId: intent.requestId,
      planDigest: intent.planDigest,
      receipt: claim,
      receiptBytes: {
        byteLength: intent.pendingReceipt.byteLength,
        byteSha256: intent.pendingReceipt.byteSha256,
      },
      selectedHeadByteSha256: intent.receipt.selectedHead.head.byteSha256,
    });
}

export function settleIntent(
  store: PublicationStore,
  intent: PublicationIntent,
): void {
  const plan = planFor(store, intent.requestId);
  reservePublicationCompletion(store, plan, false);
  const candidate = openCandidate(store, intent.receipt.candidateId);
  if (
    digest(plan) !== intent.planDigest ||
    digest(intent.receipt) !== sha256(thawBytes(intent.pendingReceipt))
  )
    recover(
      "journal-recovery-required",
      "Pending receipt binding differs.",
      intent.requestId,
    );
  readPlanFiles(store, candidate, plan);
  revalidateCandidate(store, candidate);
  const actual = nativeValue(
    store.native.observeAt(candidate.admin, store.name("00 Module.json")),
  );
  const selected = intent.receipt.selectedHead;
  const alreadySelected =
    actual.kind === "present" &&
    sameObject(actual.observation.object, selected.headClaim.object);
  if (!alreadySelected) {
    const current = currentHead(store, candidate);
    if (digest(current) !== digest(plan.previousHead))
      recover(
        "uncertain-publication",
        "Pending predecessor selector has changed.",
        intent.requestId,
        digest(plan),
      );
    const temporaryName = Buffer.from(
      intent.headReady.temporary.location.rawNameBase64,
      "base64",
    ).toString("utf8");
    store.readClaimed(
      candidate.admin,
      temporaryName,
      intent.headReady.temporary,
      intent.headReady.bytes,
    );
    store.guard();
    nativeEffect(
      store.native.replaceHeadGuarded({
        interval: store.mutating(),
        parent: candidate.admin,
        temporaryName: store.name(temporaryName),
        temporaryObject: intent.headReady.temporary.object,
        headName: store.name("00 Module.json"),
        expectedHead:
          current.kind === "absent"
            ? { kind: "absent" }
            : {
                kind: "present",
                object: current.headClaim.object,
                bytes: thawBytes(current.head),
              },
      }),
    );
  }
  store.syncDirectory(candidate.admin);
  store.readClaimed(
    candidate.admin,
    "00 Module.json",
    selected.headClaim,
    selected.head,
  );
  readPlanFiles(store, candidate, plan);
  if (
    !store
      .records()
      .some(
        (record) =>
          record.kind === "head-observed" &&
          record.requestId === intent.requestId,
      )
  )
    store.append({
      schemaVersion: 1,
      kind: "head-observed",
      requestId: intent.requestId,
      planDigest: digest(plan),
      selected,
      parentSynced: true,
      completeGraphReadback: "validated-module-data",
    });
  settleReceipt(store, intent);
}

export function pendingIntents(store: PublicationStore): PublicationIntent[] {
  const settled = new Set(
    store
      .records()
      .flatMap((record) =>
        record.kind === "settled" ? [record.requestId] : [],
      ),
  );
  return store
    .records()
    .filter(
      (record): record is PublicationIntent =>
        record.kind === "publication-intent" && !settled.has(record.requestId),
    );
}

export function reconcilePending(
  store: PublicationStore,
  releaseDigest: string,
): void {
  for (const intent of pendingIntents(store)) {
    if (
      planFor(store, intent.requestId).binding.releaseDigest !== releaseDigest
    )
      recover(
        "uncertain-publication",
        "Pending publication belongs to a different release.",
        intent.requestId,
      );
    settleIntent(store, intent);
  }
}
