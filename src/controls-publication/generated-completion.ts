import { encodePublication, freezeBytes } from "./codec.js";
import { refuse } from "./failure.js";
import type {
  CandidateReservation,
  PhysicalClaim,
  PublicationPlan,
  PublicationReceipt,
  PublicationRecord,
} from "./generated/publication-contract-1.js";
import { maximumEventBytes } from "./limits.js";
import { unsharedAllocation } from "./replay-allocation.js";
import { parseBytes, validateMixedEvent } from "./schema.js";
import type { PublicationStore } from "./store.js";

const hash = "f".repeat(64);
const object = {
  kind: "directory" as const,
  volumeUuid: "f".repeat(36),
  device: "9".repeat(20),
  inode: "9".repeat(20),
  birthtimeNs: "9".repeat(20),
};
const location = {
  parent: object,
  rawNameBase64: Buffer.alloc(255, 120).toString("base64"),
};
const directory: PhysicalClaim = {
  object,
  location,
  metadata: {
    uid: Number.MAX_SAFE_INTEGER,
    gid: Number.MAX_SAFE_INTEGER,
    mode: Number.MAX_SAFE_INTEGER,
    flags: Number.MAX_SAFE_INTEGER,
    linkCount: Number.MAX_SAFE_INTEGER,
    aclBytesBase64: Buffer.alloc(65536, 120).toString("base64"),
    localVolume: true,
  },
};
const regular: PhysicalClaim = {
  ...directory,
  object: { ...object, kind: "regular" },
};
const planned = { byteLength: Number.MAX_SAFE_INTEGER, byteSha256: hash };

function scaffold(requestId: string) {
  const common = {
    schemaVersion: 1 as const,
    requestId,
    attemptId: "a".repeat(80),
  };
  const stage = (
    purpose: "candidate" | "generation" | "retained-input",
  ): PublicationRecord[] => [
    {
      ...common,
      kind: "stage-reserved",
      purpose,
      stageLocation: location,
      finalLocation: location,
    },
    {
      ...common,
      kind: "stage-claimed",
      purpose,
      stage: purpose === "retained-input" ? regular : directory,
      finalLocation: location,
    },
  ];
  const promotion = (): PublicationRecord[] => [
    {
      ...common,
      kind: "promotion-intent",
      source: directory,
      destination: location,
      destinationExpectation: "absent",
    },
    {
      ...common,
      kind: "promotion-observed",
      object,
      from: location,
      to: location,
    },
  ];
  const file = (path: string): PublicationRecord => ({
    ...common,
    kind: "file-claimed",
    file: regular,
    path,
    planned,
  });
  const temporary = (purpose: "head" | "receipt"): PublicationRecord[] => [
    { ...common, kind: "temporary-reserved", purpose, location, planned },
    file("x".repeat(255)),
  ];
  const orphan = (): PublicationRecord => ({
    ...common,
    kind: "orphan-attempt",
    location,
    observedObject: object,
    reason: "creation-without-durable-claim",
    disposition: "retained-unadmitted",
  });
  return { common, stage, promotion, file, temporary, orphan };
}

function reserve(
  store: PublicationStore,
  requestId: string,
  records: PublicationRecord[],
  possibleOrphans: number,
): void {
  const history = store.records();
  const orphaned = new Set(
    history.flatMap((row) =>
      row.kind === "orphan-attempt" ? [row.attemptId] : [],
    ),
  );
  const claimed = new Set(
    history.flatMap((row) =>
      row.kind === "stage-claimed" || row.kind === "file-claimed"
        ? [row.attemptId]
        : [],
    ),
  );
  const priorReservations = history.filter(
    (row) =>
      (row.kind === "stage-reserved" || row.kind === "temporary-reserved") &&
      row.requestId === requestId &&
      !orphaned.has(row.attemptId),
  ).length;
  const { orphan } = scaffold(requestId);
  for (let index = 0; index < possibleOrphans + priorReservations; index++)
    records.push(orphan());
  let bytes = 0;
  let allocation = 0;
  for (const record of records) {
    const encoded = encodePublication({
      schemaVersion: 1,
      sequence: Number.MAX_SAFE_INTEGER,
      previousEventByteSha256: hash,
      record,
    });
    if (encoded.byteLength + 1 > maximumEventBytes)
      refuse(
        "invalid-controls",
        "Complete generated recovery suffix contains an event above 8 MiB.",
      );
    parseBytes(encoded, validateMixedEvent);
    bytes += encoded.byteLength + 1;
    allocation += unsharedAllocation(record);
  }
  let rows = records.length;
  for (const record of history) {
    if (
      !("requestId" in record) ||
      record.requestId !== requestId ||
      ("attemptId" in record && orphaned.has(record.attemptId)) ||
      ((record.kind === "stage-reserved" ||
        record.kind === "temporary-reserved") &&
        !claimed.has(record.attemptId))
    )
      continue;
    const encoded = encodePublication({
      schemaVersion: 1,
      sequence: Number.MAX_SAFE_INTEGER,
      previousEventByteSha256: hash,
      record,
    });
    bytes -= encoded.byteLength + 1;
    allocation -= unsharedAllocation(record);
    rows--;
  }
  store.reserveCompletion({ bytes, rows, allocation }, requestId);
}

export function reserveCandidateCompletion(
  store: PublicationStore,
  reservation: CandidateReservation,
  fresh: boolean,
): void {
  const requestId = reservation.binding.requestId;
  const { common, stage, promotion } = scaffold(requestId);
  const records: PublicationRecord[] = fresh ? [reservation] : [];
  records.push(...stage("candidate"));
  for (let index = 0; index < 4; index++)
    records.push({ ...common, kind: "directory-claimed", directory });
  records.push(...promotion(), {
    schemaVersion: 1,
    kind: "generated-candidate-admitted",
    candidateId: reservation.candidateId,
    createBindingDigest: hash,
    aggregate: reservation.aggregate,
    root: directory,
    policy: "generated-publication/1",
    effect: "private-generated-controls/1",
    releaseDigest: reservation.binding.releaseDigest,
  });
  reserve(store, requestId, records, 1);
}

export function reservePublicationCompletion(
  store: PublicationStore,
  plan: PublicationPlan,
  fresh: boolean,
): void {
  const requestId = plan.binding.requestId;
  if (!fresh && store.completionReservedFor(requestId)) return;
  const { common, stage, promotion, file, temporary } = scaffold(requestId);
  const records: PublicationRecord[] = fresh ? [plan] : [];
  records.push(...stage("generation"));
  const directories = new Set<string>();
  const prefix = `.academic-os/control-generations/${plan.generationId}/`;
  let dependencies = 0;
  for (const row of plan.files) {
    if (row.kind === "head") continue;
    if (row.kind === "retained-input") {
      dependencies++;
      records.push(...stage("retained-input"), file(row.path), ...promotion());
      continue;
    }
    const parts = row.path.slice(prefix.length).split("/");
    parts.pop();
    let path = "";
    for (const part of parts) {
      path += `/${part}`;
      if (!directories.has(path)) {
        directories.add(path);
        records.push({ ...common, kind: "directory-claimed", directory });
      }
    }
    records.push(file(row.path));
  }
  records.push(...promotion(), ...temporary("head"));
  const head = plan.files.find((row) => row.kind === "head");
  const manifest = plan.files.find((row) => row.kind === "generation");
  if (!head || !manifest)
    refuse(
      "invalid-controls",
      "Complete publication plan lacks its head or manifest.",
    );
  const ready = {
    schemaVersion: 1 as const,
    kind: "head-ready" as const,
    requestId,
    planDigest: hash,
    temporary: regular,
    finalLocation: location,
    bytes: head.bytes,
    expected: plan.previousHead,
  };
  records.push(ready);
  const selected = {
    kind: "selected" as const,
    head: head.bytes,
    headClaim: regular,
    generationId: plan.generationId,
    generationManifest: {
      byteLength: manifest.bytes.byteLength,
      byteSha256: manifest.bytes.byteSha256,
    },
    generationRoot: directory,
  };
  const receipt: PublicationReceipt = {
    schemaVersion: 1,
    kind: "publication-receipt",
    receiptId: `receipt-${hash}`,
    requestId,
    candidateId: plan.binding.candidateId,
    planDigest: hash,
    bindingDigest: hash,
    previousHead: plan.previousHead,
    selectedHead: selected,
    manifest: plan.files,
    effect: "private-generated-controls/1",
  };
  const pendingReceipt = freezeBytes(encodePublication(receipt));
  records.push({
    schemaVersion: 1,
    kind: "publication-intent",
    requestId,
    planDigest: hash,
    headReady: ready,
    pendingReceipt,
    receipt,
  });
  records.push({
    schemaVersion: 1,
    kind: "head-observed",
    requestId,
    planDigest: hash,
    selected,
    parentSynced: true,
    completeGraphReadback: "validated-module-data",
  });
  records.push(
    ...temporary("receipt"),
    {
      schemaVersion: 1,
      kind: "receipt-ready",
      requestId,
      receiptId: receipt.receiptId,
      temporary: regular,
      finalLocation: location,
      bytes: pendingReceipt,
    },
    ...promotion(),
    {
      schemaVersion: 1,
      kind: "settled",
      requestId,
      planDigest: hash,
      receipt: regular,
      receiptBytes: planned,
      selectedHeadByteSha256: hash,
    },
  );
  reserve(store, requestId, records, dependencies + 3);
}
