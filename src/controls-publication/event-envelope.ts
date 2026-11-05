import { encodePublication } from "./codec.js";
import type {
  JournalEvent,
  PhysicalClaim,
  PublicationRecord,
} from "./generated/publication-contract-1.js";
import { maximumEventBytes } from "./limits.js";

export function maximumReceiptBytes(): number {
  let low = 0;
  let high = maximumEventBytes;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (middle + 4 * Math.ceil(middle / 3) <= maximumEventBytes) low = middle;
    else high = middle - 1;
  }
  return low;
}

// Intent contains both the canonical receipt and its base64. Native/schema
// producer bounds limit every later scaffold. The source-bound test guards them.
export function futureEventEnvelope(): ReadonlyMap<
  PublicationRecord["kind"],
  number
> {
  const identity = {
    kind: "directory" as const,
    volumeUuid: "f".repeat(36),
    device: "9".repeat(20),
    inode: "9".repeat(20),
    birthtimeNs: "9".repeat(20),
  };
  const location = {
    parent: identity,
    rawNameBase64: Buffer.alloc(255, 120).toString("base64"),
  };
  const claim: PhysicalClaim = {
    object: identity,
    metadata: {
      uid: Number.MAX_SAFE_INTEGER,
      gid: Number.MAX_SAFE_INTEGER,
      mode: Number.MAX_SAFE_INTEGER,
      flags: Number.MAX_SAFE_INTEGER,
      linkCount: Number.MAX_SAFE_INTEGER,
      aclBytesBase64: Buffer.alloc(65536, 120).toString("base64"),
      localVolume: true,
    },
    location,
  };
  const binding = {
    byteLength: Number.MAX_SAFE_INTEGER,
    byteSha256: "f".repeat(64),
  };
  const common = { schemaVersion: 1 as const, requestId: "r".repeat(80) };
  const records: PublicationRecord[] = [
    {
      ...common,
      kind: "temporary-reserved",
      attemptId: "a".repeat(80),
      purpose: "receipt",
      location,
      planned: binding,
    },
    {
      ...common,
      kind: "file-claimed",
      attemptId: "a".repeat(80),
      path: "x".repeat(255),
      file: claim,
      planned: binding,
    },
    {
      ...common,
      kind: "receipt-ready",
      receiptId: "r".repeat(80),
      temporary: claim,
      finalLocation: location,
      bytes: { ...binding, bytesBase64: "" },
    },
    {
      ...common,
      kind: "promotion-intent",
      attemptId: "a".repeat(80),
      source: claim,
      destination: location,
      destinationExpectation: "absent",
    },
    {
      ...common,
      kind: "promotion-observed",
      attemptId: "a".repeat(80),
      object: identity,
      from: location,
      to: location,
    },
    {
      ...common,
      kind: "settled",
      planDigest: "f".repeat(64),
      receipt: claim,
      receiptBytes: binding,
      selectedHeadByteSha256: "f".repeat(64),
    },
    {
      ...common,
      kind: "orphan-attempt",
      attemptId: "a".repeat(80),
      location,
      observedObject: identity,
      reason: "creation-without-durable-claim",
      disposition: "retained-unadmitted",
    },
  ];
  const bounds = new Map<PublicationRecord["kind"], number>();
  for (const record of records) {
    const event: JournalEvent = {
      schemaVersion: 1,
      sequence: Number.MAX_SAFE_INTEGER,
      previousEventByteSha256: "f".repeat(64),
      record,
    };
    bounds.set(record.kind, encodePublication(event).byteLength + 1);
  }
  const receiptLength = maximumReceiptBytes();
  bounds.set(
    "receipt-ready",
    (bounds.get("receipt-ready") ?? 0) + 4 * Math.ceil(receiptLength / 3),
  );
  const headObserved = {
    schemaVersion: 1,
    sequence: Number.MAX_SAFE_INTEGER,
    previousEventByteSha256: "f".repeat(64),
    record: {
      ...common,
      kind: "head-observed",
      planDigest: "f".repeat(64),
      selected: {},
      parentSynced: true,
      completeGraphReadback: "validated-module-data",
    },
  };
  bounds.set(
    "head-observed",
    encodePublication(headObserved).byteLength + 1 + receiptLength - 2,
  );
  return bounds;
}

export const normalPostIntentKinds = [
  "head-observed",
  "temporary-reserved",
  "file-claimed",
  "receipt-ready",
  "promotion-intent",
  "promotion-observed",
  "settled",
] satisfies readonly PublicationRecord["kind"][];
