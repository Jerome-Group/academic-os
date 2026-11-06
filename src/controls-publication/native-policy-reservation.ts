import { encodePublication } from "./codec.js";
import { refuse } from "./failure.js";
import type {
  HostRegistrationIntent,
  InstallReceipt,
  OwnedBlob,
  PolicyInstallIntent,
  Reservation,
} from "./generated/native-source-contract-1.js";
import type { PhysicalClaim } from "./generated/publication-contract-1.js";
import { maximumEventBytes } from "./limits.js";
import { attemptScope, operationBinding } from "./native-policy-history.js";
import { planned } from "./native-policy-persistence.js";
import { type MixedRecord, parseBytes, validateMixedEvent } from "./schema.js";
import { unsharedAllocation } from "./replay-allocation.js";

export const emptyReservation: Reservation = {
  eventCount: "0",
  ledgerBytes: "0",
  retainedBytes: "0",
  indexBytes: "0",
  maximumAttempts: 3,
};

const capacities = new WeakMap<
  object,
  { reservation: Reservation; allocation: number }
>();

export function reserveNativePlan(
  intent: HostRegistrationIntent | PolicyInstallIntent,
): Reservation {
  return nativePlanCapacity(intent).reservation;
}

export function nativePlanAllocation(
  intent: HostRegistrationIntent | PolicyInstallIntent,
): number {
  return nativePlanCapacity(intent).allocation;
}

function nativePlanCapacity(
  intent: HostRegistrationIntent | PolicyInstallIntent,
): { reservation: Reservation; allocation: number } {
  const prior = capacities.get(intent);
  if (prior) return prior;
  const hash = "f".repeat(64);
  const identity = {
    kind: "regular" as const,
    volumeUuid: "f".repeat(64),
    device: "18446744073709551615",
    inode: "18446744073709551615",
    birthtimeNs: "9223372036854775807999999999",
  };
  const directory = { ...identity, kind: "directory" as const };
  const rawNameBase64 = Buffer.alloc(255, 120).toString("base64");
  const physical: PhysicalClaim = {
    object: identity,
    location: { parent: directory, rawNameBase64 },
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
  const target = { parentClaimId: hash, rawNameBase64 };
  const blob: OwnedBlob = {
    kind: "owned-blob",
    evidenceId: hash,
    claim: {
      claimId: hash,
      generatedClaimRecordDigest: hash,
      object: identity,
      location: target,
    },
    byteLength: "1048576",
    sha256: hash,
  };
  const records: MixedRecord[] = [
    {
      ...intent,
      reservation: {
        eventCount: "9999999999999999",
        ledgerBytes: "9999999999999999",
        retainedBytes: "9999999999999999",
        indexBytes: "9999999999999999",
        maximumAttempts: 3,
      },
    },
  ];
  let retainedBytes = 0;
  for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber++) {
    const scope = attemptScope(intent, attemptNumber);
    const binding = operationBinding(scope, "install-policy", target, hash);
    const common = {
      schemaVersion: 1 as const,
      requestId: `n${hash}`,
      attemptId: `a${hash}`,
    };
    records.push({
      schemaVersion: 2,
      kind: "native-stage-reserved",
      scope,
      binding,
      stage: target,
      final: target,
      envelopeClaimId: hash,
    });
    for (let index = 0; index < 4; index++)
      records.push({
        ...common,
        kind: "directory-claimed",
        directory: { ...physical, object: directory },
      });
    const files = intent.kind === "native-source-policy-install-intent" ? 3 : 2;
    for (let index = 0; index < files; index++)
      records.push({
        ...common,
        kind: "file-claimed",
        file: physical,
        path: "x".repeat(1024),
        planned: { byteLength: 1048576, byteSha256: hash },
      });
    const promotions =
      intent.kind === "native-source-policy-install-intent" ? 3 : 2;
    for (let index = 0; index < promotions; index++) {
      records.push({
        ...common,
        kind: "promotion-intent",
        source: physical,
        destination: physical.location,
        destinationExpectation: "absent",
      });
      records.push({
        ...common,
        kind: "promotion-observed",
        object: identity,
        from: physical.location,
        to: physical.location,
      });
    }
    records.push({
      schemaVersion: 2,
      kind: "native-selector-move-intent",
      scope,
      binding,
      generatedClaimRecordDigest: hash,
      expectedPrior: blob,
    });
    records.push({
      schemaVersion: 2,
      kind: "native-selector-move-observed",
      scope,
      binding,
      moveIntentDigest: hash,
      object: identity,
      parentBarrier: true,
    });
    records.push({
      ...common,
      kind: "orphan-attempt",
      location: physical.location,
      observedObject: identity,
      reason: "creation-without-durable-claim",
      disposition: "retained-unadmitted",
    });
    records.push({
      schemaVersion: 2,
      kind: "native-attempt-retained",
      scope,
      binding,
      reason: "creation-without-claim",
      pendingOperationsDigest: hash,
      observationDigest: hash,
      processDrained: true,
    });
    if (intent.kind === "native-source-policy-install-intent") {
      const body: InstallReceipt = {
        schema: "native-source-policy-install-receipt/1",
        scope,
        generation: blob,
        selector: blob,
        policyIntentDigest: hash,
        deploymentDigest: hash,
        coverage: "registered-deployments-only",
        quiescence: "cooperating-private-input-required",
        releaseDigest: hash,
      };
      const bytes = encodePublication(body);
      if (bytes.byteLength > 65536)
        refuse(
          "invalid-controls",
          "Policy receipt exceeds 64 KiB before installation effects.",
        );
      records.push({
        schemaVersion: 2,
        kind: "native-source-policy-generation-settled",
        scope,
        binding,
        policyIntentDigest: hash,
        blob,
        fileBarrier: true,
        parentBarrier: true,
      });
      records.push({
        schemaVersion: 2,
        kind: "native-source-policy-selector-intent",
        scope,
        binding,
        policyIntentDigest: hash,
        prior: blob,
        priorGeneration: blob,
        generation: blob,
      });
      records.push({
        schemaVersion: 2,
        kind: "native-source-policy-selector-settled",
        scope,
        binding,
        selectorIntentDigest: hash,
        selector: blob,
        generation: blob,
        parentBarrier: true,
      });
      records.push({
        schemaVersion: 2,
        kind: "native-source-policy-receipt-intent",
        scope,
        binding,
        selectorSettledDigest: hash,
        body,
        planned: planned(
          bytes,
          "installation-receipt",
          "native-policy-install-receipt/1",
        ),
      });
      records.push({
        schemaVersion: 2,
        kind: "native-source-policy-receipt-settled",
        scope,
        binding,
        receiptIntentDigest: hash,
        blob,
        fileBarrier: true,
        parentBarrier: true,
      });
      retainedBytes +=
        encodePublication(intent.policy).byteLength +
        bytes.byteLength +
        2 * 1048576;
    } else {
      records.push({
        schemaVersion: 2,
        kind: "native-host-deployment-settled",
        intentDigest: hash,
        registration: blob,
        fileBarrier: true,
        parentBarrier: true,
      });
      retainedBytes +=
        2 * encodePublication(intent.registration).byteLength + 1048576;
    }
  }
  let ledgerBytes = 0;
  let allocation = 0;
  for (const record of records) {
    const bytes = encodePublication({
      schemaVersion: 1,
      sequence: Number.MAX_SAFE_INTEGER,
      previousEventByteSha256: hash,
      record,
    });
    if (bytes.byteLength + 1 > maximumEventBytes)
      refuse(
        "invalid-controls",
        "Native reservation contains an event above 8 MiB.",
      );
    parseBytes(bytes, validateMixedEvent);
    ledgerBytes += bytes.byteLength + 1;
    allocation += unsharedAllocation(record);
  }
  const reservation: Reservation = {
    eventCount: String(records.length),
    ledgerBytes: String(ledgerBytes),
    retainedBytes: String(retainedBytes),
    indexBytes: "0",
    maximumAttempts: 3,
  };
  const capacity = { reservation, allocation };
  capacities.set(intent, capacity);
  return capacity;
}
