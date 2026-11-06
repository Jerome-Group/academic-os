import { digest, encodePublication, sha256 } from "./codec.js";
import { PublicationFailure, recover, refuse } from "./failure.js";
import type {
  AttemptScope,
  HostRegistrationIntent,
  Record as NativeRecord,
  OwnedBlob,
  PlannedEvidence,
  PolicyInstallIntent,
  Reservation,
} from "./generated/native-source-contract-1.js";
import type {
  FileClaim,
  ObjectIdentity,
  PhysicalClaim,
  PromotionIntent,
} from "./generated/publication-contract-1.js";
import type { DirectoryHandle } from "./native-contract.js";
import { attemptScope, operationBinding } from "./native-policy-history.js";
import type { MixedRecord } from "./schema.js";
import {
  nativeEffect,
  nativeValue,
  type PublicationStore,
  sameLocation,
  sameObject,
} from "./store.js";

export const policySelectorName = "native-source-policy.json";
export const deploymentSelectorName = "host-deployment.json";
export const directories = [
  "host-deployments",
  "native-source-policy",
  "native-policy-receipts",
  "native-policy-staging",
] as const;

export function appendOnce<T extends NativeRecord>(
  store: PublicationStore,
  record: T,
): T {
  const key = (value: NativeRecord) =>
    "scope" in value
      ? `${value.kind}:${digest(value.scope)}:${"binding" in value ? value.binding.operationId : ""}`
      : value.kind === "native-host-deployment-settled"
        ? `${value.kind}:${value.intentDigest}`
        : value.kind === "native-host-deployment-intent"
          ? `${value.kind}:${value.request.requestId}`
          : digest(value);
  const prior = store
    .mixedRecords()
    .find((value) => value.schemaVersion === 2 && key(value) === key(record));
  if (prior) {
    if (digest(prior) !== digest(record))
      refuse(
        "request-conflict",
        "A deterministic native operation was rebound.",
      );
    return record;
  }
  store.append(record);
  return record;
}

export function parentClaimId(
  store: PublicationStore,
  parent: DirectoryHandle,
): string {
  const object = store.observation(parent).object;
  if (sameObject(object, store.namespaceClaim.namespace.object))
    return digest(store.namespaceClaim);
  const record = store
    .records()
    .find(
      (row) =>
        row.kind === "directory-claimed" &&
        sameObject(row.directory.object, object),
    );
  if (!record)
    recover(
      "uncertain-claim",
      "Native output parent has no complete generated claim.",
    );
  return digest(record);
}
export function location(
  store: PublicationStore,
  parent: DirectoryHandle,
  name: string,
) {
  return {
    parentClaimId: parentClaimId(store, parent),
    rawNameBase64: Buffer.from(name).toString("base64"),
  };
}
export function planned(
  bytes: Uint8Array,
  purpose: PlannedEvidence["purpose"],
  format: PlannedEvidence["format"],
): PlannedEvidence {
  return {
    kind: "planned",
    evidenceId: digest({
      purpose,
      format,
      sha256: sha256(bytes),
      byteLength: String(bytes.byteLength),
    }),
    purpose,
    format,
    sha256: sha256(bytes),
    byteLength: String(bytes.byteLength),
    chunkCount: 1,
  };
}
export function ownedBlob(
  store: PublicationStore,
  parent: DirectoryHandle,
  name: string,
  claim: PhysicalClaim,
  bytes: Uint8Array,
  evidenceId: string,
  claimId?: string,
): OwnedBlob {
  const row = store
    .records()
    .find(
      (record): record is FileClaim =>
        record.kind === "file-claimed" &&
        sameObject(record.file.object, claim.object),
    );
  if (
    !row ||
    row.planned.byteSha256 !== sha256(bytes) ||
    row.planned.byteLength !== bytes.byteLength
  )
    recover(
      "uncertain-claim",
      "Native blob lacks its exact generated file claim.",
    );
  return {
    kind: "owned-blob",
    evidenceId,
    claim: {
      claimId:
        claimId ??
        digest({
          generatedClaimRecordDigest: digest(row),
          object: row.file.object,
        }),
      generatedClaimRecordDigest: digest(row),
      object: claim.object,
      location: location(store, parent, name),
    },
    byteLength: String(bytes.byteLength),
    sha256: sha256(bytes),
  };
}
export function readOwned(
  store: PublicationStore,
  parent: DirectoryHandle,
  name: string,
  blob: OwnedBlob,
): Uint8Array {
  const row = store
    .records()
    .find(
      (record): record is FileClaim =>
        record.kind === "file-claimed" &&
        digest(record) === blob.claim.generatedClaimRecordDigest,
    );
  if (
    !row ||
    !sameObject(row.file.object, blob.claim.object) ||
    blob.claim.location.parentClaimId !== parentClaimId(store, parent) ||
    row.planned.byteLength.toString() !== blob.byteLength ||
    row.planned.byteSha256 !== blob.sha256
  )
    recover("uncertain-claim", "Native blob ownership binding differs.");
  const physical = { ...row.file, location: store.location(parent, name) };
  store.requireClaim(parent, name, physical);
  const file = store.openFile(parent, name, physical);
  if (digest(store.observation(file).metadata) !== digest(row.file.metadata))
    refuse("root-replaced", "Claimed native control metadata changed.");
  return store.readClaimed(parent, name, physical, {
    byteLength: row.planned.byteLength,
    byteSha256: blob.sha256,
  });
}
export function strictDirectory(
  store: PublicationStore,
  name: (typeof directories)[number],
  scope: AttemptScope,
): DirectoryHandle {
  return store.directory(
    store.namespace,
    name,
    `n${scope.intentDigest}`,
    `a${scope.attemptId}`,
  );
}

export function persistImmutable(
  store: PublicationStore,
  scope: AttemptScope,
  parent: DirectoryHandle,
  name: string,
  bytes: Uint8Array,
  purpose: PlannedEvidence["purpose"],
  format: PlannedEvidence["format"],
): OwnedBlob {
  const staging = strictDirectory(store, "native-policy-staging", scope);
  const stageName = `${scope.attemptId}-${purpose}`;
  const bridge = {
    requestId: `n${scope.intentDigest}`,
    attemptId: `a${scope.attemptId}`,
  };
  const finalLocation = store.location(parent, name);
  const promotion = store
    .records()
    .find(
      (record): record is PromotionIntent =>
        record.kind === "promotion-intent" &&
        record.requestId === bridge.requestId &&
        sameLocation(record.destination, finalLocation),
    );
  let claim: PhysicalClaim;
  if (promotion) {
    const sourceName = Buffer.from(
      promotion.source.location.rawNameBase64,
      "base64",
    ).toString("utf8");
    const final = nativeValue(store.native.observeAt(parent, store.name(name)));
    if (final.kind === "present") {
      if (!sameObject(final.observation.object, promotion.source.object))
        refuse(
          "unowned-output",
          "Immutable native output belongs to a foreign physical object.",
        );
      claim = store.promote({
        requestId: bridge.requestId,
        attemptId: promotion.attemptId,
        sourceParent: staging,
        sourceName,
        claim: promotion.source,
        destinationParent: parent,
        destinationName: name,
      });
    } else {
      claim = store.write(staging, sourceName, {
        ...bridge,
        attemptId: promotion.attemptId,
        path: `${"native-policy-staging"}/${sourceName}`,
        bytes,
      });
      claim = store.promote({
        requestId: bridge.requestId,
        attemptId: promotion.attemptId,
        sourceParent: staging,
        sourceName,
        claim,
        destinationParent: parent,
        destinationName: name,
      });
    }
  } else {
    if (
      nativeValue(store.native.observeAt(parent, store.name(name))).kind !==
      "absent"
    )
      refuse(
        "unowned-output",
        "Unknown immutable native output cannot be adopted from equal bytes.",
      );
    claim = store.write(staging, stageName, {
      ...bridge,
      path: `native-policy-staging/${stageName}`,
      bytes,
    });
    claim = store.promote({
      ...bridge,
      sourceParent: staging,
      sourceName: stageName,
      claim,
      destinationParent: parent,
      destinationName: name,
    });
  }
  const plan = planned(bytes, purpose, format);
  const blob = ownedBlob(store, parent, name, claim, bytes, plan.evidenceId);
  readOwned(store, parent, name, blob);
  nativeEffect(
    store.native.syncFile({
      interval: store.mutating(),
      file: store.openFile(parent, name, claim),
    }),
    "durability-unavailable",
  );
  store.syncDirectory(parent);
  return blob;
}

export function historyName(name: string, blob: OwnedBlob): string {
  return `${name.slice(0, -5)}-history-${blob.claim.generatedClaimRecordDigest}.json`;
}
export function selectorBytes(
  generation: OwnedBlob,
  hostAccountDigest: string,
): Uint8Array {
  return encodePublication({
    schema: "native-source-policy-selector/1",
    generation,
    hostAccountDigest,
  });
}

export function replaceSelector(
  store: PublicationStore,
  scope: AttemptScope,
  name: string,
  bytes: Uint8Array,
  prior: OwnedBlob | null,
  claimId?: string,
): OwnedBlob {
  const temporaryName = `selector-${scope.attemptId}`;
  const bridge = {
    requestId: `n${scope.intentDigest}`,
    attemptId: `a${scope.attemptId}`,
  };
  const priorRow = store
    .records()
    .find(
      (record): record is FileClaim =>
        record.kind === "file-claimed" &&
        record.requestId === bridge.requestId &&
        record.attemptId === bridge.attemptId &&
        record.path === temporaryName,
    );
  const selected = nativeValue(
    store.native.observeAt(store.namespace, store.name(name)),
  );
  const replay =
    priorRow &&
    selected.kind === "present" &&
    sameObject(selected.observation.object, priorRow.file.object);
  const claim = replay
    ? priorRow.file
    : store.write(store.namespace, temporaryName, {
        ...bridge,
        path: temporaryName,
        bytes,
      });
  let expectedHead: Parameters<
    typeof store.native.replaceSelectorGuarded
  >[0]["expectedHead"] = { kind: "absent" };
  if (prior) {
    if (prior.claim.object.kind !== "regular")
      recover(
        "uncertain-claim",
        "Policy selector claim must be a regular generated file.",
      );
    const priorObject: ObjectIdentity = {
      ...prior.claim.object,
      kind: "regular",
    };
    const archive = historyName(name, prior);
    const currentOld =
      selected.kind === "present" &&
      sameObject(selected.observation.object, prior.claim.object);
    const archiveObserved = nativeValue(
      store.native.observeAt(store.namespace, store.name(archive)),
    );
    const oldName = currentOld
      ? name
      : archiveObserved.kind === "present"
        ? archive
        : temporaryName;
    const oldBytes = readOwned(store, store.namespace, oldName, prior);
    expectedHead = { kind: "present", object: priorObject, bytes: oldBytes };
    const original = store
      .records()
      .find(
        (row): row is FileClaim =>
          row.kind === "file-claimed" &&
          digest(row) === prior.claim.generatedClaimRecordDigest,
      );
    if (!original)
      recover(
        "uncertain-claim",
        "Expected old selector has no original claim.",
      );
    if (
      !store
        .records()
        .some(
          (row) =>
            row.kind === "promotion-intent" &&
            row.requestId === bridge.requestId &&
            sameLocation(
              row.destination,
              store.location(store.namespace, archive),
            ),
        )
    )
      store.append({
        schemaVersion: 1,
        kind: "promotion-intent",
        ...bridge,
        source: {
          ...original.file,
          location: store.location(store.namespace, name),
        },
        destination: store.location(store.namespace, archive),
        destinationExpectation: "absent",
      });
  }
  nativeEffect(
    store.native.replaceSelectorGuarded({
      interval: store.mutating(),
      parent: store.namespace,
      temporaryName: store.name(temporaryName),
      temporaryObject: claim.object,
      headName: store.name(name),
      expectedHead,
      historyName: store.name(
        prior ? historyName(name, prior) : `unused-${scope.attemptId}`,
      ),
    }),
  );
  store.syncDirectory(store.namespace);
  if (prior) {
    if (prior.claim.object.kind !== "regular")
      recover(
        "uncertain-claim",
        "Policy selector claim must be a regular generated file.",
      );
    const priorObject: ObjectIdentity = {
      ...prior.claim.object,
      kind: "regular",
    };
    const archive = historyName(name, prior);
    readOwned(store, store.namespace, archive, prior);
    if (
      !store
        .records()
        .some(
          (row) =>
            row.kind === "promotion-observed" &&
            row.requestId === bridge.requestId &&
            sameLocation(row.to, store.location(store.namespace, archive)),
        )
    )
      store.append({
        schemaVersion: 1,
        kind: "promotion-observed",
        ...bridge,
        object: priorObject,
        from: store.location(store.namespace, name),
        to: store.location(store.namespace, archive),
      });
  }
  const blob = ownedBlob(
    store,
    store.namespace,
    name,
    { ...claim, location: store.location(store.namespace, name) },
    bytes,
    digest({ purpose: name, sha256: sha256(bytes) }),
    claimId,
  );
  readOwned(store, store.namespace, name, blob);
  nativeEffect(
    store.native.syncFile({
      interval: store.mutating(),
      file: store.openFile(store.namespace, name),
    }),
    "durability-unavailable",
  );
  store.syncDirectory(store.namespace);
  return blob;
}

export function withAttempts<T>(
  store: PublicationStore,
  intent: PolicyInstallIntent | HostRegistrationIntent,
  run: (scope: AttemptScope) => T,
): T {
  for (let number = 1; number <= 3; number++) {
    const scope = attemptScope(intent, number);
    if (
      store
        .mixedRecords()
        .some(
          (record) =>
            record.kind === "native-attempt-retained" &&
            record.scope.attemptId === scope.attemptId,
        )
    )
      continue;
    const target = location(
      store,
      store.namespace,
      `attempt-${scope.attemptId}`,
    );
    appendOnce(store, {
      schemaVersion: 2,
      kind: "native-stage-reserved",
      scope,
      binding: operationBinding(scope, "reserve-stage", target, digest(intent)),
      stage: target,
      final: target,
      envelopeClaimId: digest(target),
    });
    try {
      return run(scope);
    } catch (error) {
      if (
        error instanceof PublicationFailure &&
        error.result.kind === "recovery-required" &&
        error.result.code === "uncertain-claim"
      )
        appendOnce(store, {
          schemaVersion: 2,
          kind: "native-attempt-retained",
          scope,
          binding: operationBinding(
            scope,
            "retain-attempt",
            target,
            digest(intent),
          ),
          reason: "creation-without-claim",
          pendingOperationsDigest: digest(intent),
          observationDigest: digest(error.result),
          processDrained: true,
        });
      throw error;
    }
  }
  recover(
    "uncertain-claim",
    "Three retained native attempts exhausted this request. All residue remains retained.",
    "scope" in intent ? intent.scope.requestId : intent.request.requestId,
    digest(intent),
  );
}

export function reserveSuffix(
  store: PublicationStore,
  reservation: Reservation,
  intent: MixedRecord,
): void {
  const history = store.mixedRecords();
  const start = history.findIndex((row) => digest(row) === digest(intent));
  const remainingRows =
    Number(reservation.eventCount) - (start < 0 ? 0 : history.length - start);
  const spentBytes =
    start < 0
      ? 0
      : history.slice(start).reduce(
          (sum, row) =>
            sum +
            encodePublication({
              schemaVersion: 1,
              sequence: Number.MAX_SAFE_INTEGER,
              previousEventByteSha256: "f".repeat(64),
              record: row,
            }).byteLength +
            1,
          0,
        );
  const remainingBytes = Number(reservation.ledgerBytes) - spentBytes;
  if (
    !Number.isSafeInteger(remainingBytes) ||
    remainingBytes < 0 ||
    remainingRows < 1
  )
    recover(
      "durability-unavailable",
      "The frozen native recovery suffix is exhausted.",
    );
  store.requireAppendCapacity(remainingBytes, remainingRows);
}
