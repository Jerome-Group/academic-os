import { digest, encodePublication } from "./codec.js";
import { recover, refuse } from "./failure.js";
import type {
  AttemptScope,
  Binding,
  HostRegistrationIntent,
  OwnedBlob,
  PolicyInstallIntent,
} from "./generated/native-source-contract-1.js";
import type { MixedRecord } from "./schema.js";
import { type PublicationStore, sameObject } from "./store.js";

export type RequestKind =
  | "candidate-reserved"
  | "publication-plan"
  | "native-host-deployment-intent"
  | "native-source-policy-install-intent";
export function requestIdentity(
  record: MixedRecord,
): { requestId: string; kind: RequestKind } | undefined {
  switch (record.kind) {
    case "candidate-reserved":
    case "publication-plan":
      return { requestId: record.binding.requestId, kind: record.kind };
    case "native-host-deployment-intent":
      return { requestId: record.request.requestId, kind: record.kind };
    case "native-source-policy-install-intent":
      return { requestId: record.scope.requestId, kind: record.kind };
    default:
      return undefined;
  }
}
export function requireRequestOwnership(
  store: Pick<PublicationStore, "mixedRecords">,
  requestId: string,
  kind: RequestKind,
): void {
  const records = store.mixedRecords();
  const prior = records
    .map(requestIdentity)
    .find((row) => row?.requestId === requestId);
  if (prior) {
    if (prior.kind !== kind)
      refuse(
        "request-conflict",
        "Request identity belongs to another generated or native operation.",
      );
    return;
  }
  const bridge = records.some((record) =>
    record.kind === "native-host-deployment-intent"
      ? requestId === `n${digest(record)}`
      : record.kind === "native-source-policy-install-intent"
        ? requestId === `n${record.scope.intentDigest}`
        : false,
  );
  if (
    bridge ||
    records.some(
      (record) => "requestId" in record && record.requestId === requestId,
    )
  )
    refuse(
      "request-conflict",
      "Request identity belongs to retained internal work.",
    );
  if (
    kind.startsWith("native-") &&
    records.filter(
      (record) =>
        record.kind === "native-host-deployment-intent" ||
        record.kind === "native-source-policy-install-intent",
    ).length >= 4096
  )
    refuse("invalid-controls", "Native request catalog exceeds 4096 requests.");
}
export function requireNativeBridge(
  store: Pick<PublicationStore, "mixedRecords">,
  intentDigest: string,
): void {
  const bridge = `n${intentDigest}`;
  if (
    store
      .mixedRecords()
      .some(
        (record) =>
          requestIdentity(record)?.requestId === bridge ||
          ("requestId" in record && record.requestId === bridge),
      )
  )
    refuse(
      "request-conflict",
      "Native bridge identity collides with retained request ownership.",
    );
}
export function requireRecordAdmission(
  store: Pick<PublicationStore, "mixedRecords">,
  record: MixedRecord,
): void {
  const identity = requestIdentity(record);
  if (!identity) return;
  requireRequestOwnership(store, identity.requestId, identity.kind);
  if (
    store
      .mixedRecords()
      .some((row) => requestIdentity(row)?.requestId === identity.requestId)
  )
    refuse("request-conflict", "Request already has a durable intent.");
  if (record.kind === "native-host-deployment-intent")
    requireNativeBridge(store, digest(record));
  if (record.kind === "native-source-policy-install-intent")
    requireNativeBridge(store, record.scope.intentDigest);
}

function requireFact(value: unknown, message: string): asserts value {
  if (!value) recover("journal-recovery-required", message);
}
export function attemptScope(
  intent: PolicyInstallIntent | HostRegistrationIntent,
  attemptNumber: number,
): AttemptScope {
  const intentDigest =
    "scope" in intent ? intent.scope.intentDigest : digest(intent);
  return {
    requestId:
      "scope" in intent ? intent.scope.requestId : intent.request.requestId,
    intentDigest,
    candidateId:
      "scope" in intent
        ? intent.scope.candidateId
        : `deployment:${digest(intent.registration)}`,
    attemptNumber,
    attemptId: digest({ intentDigest, attemptNumber }),
  };
}
export function operationBinding(
  scope: AttemptScope,
  effect: Binding["effect"],
  location: Binding["location"],
  plannedEffectDigest: string,
  claimId = digest({ scope, effect, location }),
): Binding {
  return {
    operationId: digest({ scope, effect, location, plannedEffectDigest }),
    effect,
    claimId,
    location,
    plannedEffectDigest,
  };
}

export function validateMixedHistory(store: PublicationStore): void {
  const events = new Map<string, MixedRecord>();
  const intents = new Map<
    string,
    PolicyInstallIntent | HostRegistrationIntent
  >();
  const rows = new Map<string, string>();
  const attempts = new Set<string>();
  const requestOwners = new Map<string, string>();
  const installationPredecessors = new Map<
    string,
    { prior: OwnedBlob | null; priorGeneration: OwnedBlob | null }
  >();
  let selected: { selector: OwnedBlob; generation: OwnedBlob } | undefined;
  let registration: OwnedBlob | null = null;
  let count = 0;
  const same = (a: unknown, b: unknown) => digest(a) === digest(b);
  const knownBlobs = new Map<string, OwnedBlob>();
  const physicalClaims = new Map<string, string>();
  const owned = (blob: OwnedBlob) => {
    const claim = events.get(blob.claim.generatedClaimRecordDigest);
    requireFact(
      claim?.kind === "file-claimed",
      "Native blob has no preceding generated file claim.",
    );
    requireFact(
      sameObject(claim.file.object, blob.claim.object) &&
        claim.planned.byteLength.toString() === blob.byteLength &&
        claim.planned.byteSha256 === blob.sha256,
      "Native blob differs from its complete generated ownership binding.",
    );
    const parent = events.get(blob.claim.location.parentClaimId);
    requireFact(
      parent?.kind === "namespace-claimed" ||
        parent?.kind === "directory-claimed",
      "Native blob parent is not a strict generated claim.",
    );
    const identity =
      parent.kind === "namespace-claimed"
        ? parent.namespace.object
        : parent.directory.object;
    if (!sameObject(claim.file.location.parent, identity)) {
      const promotion = [...events.values()].find(
        (event) =>
          event.kind === "promotion-observed" &&
          sameObject(event.object, blob.claim.object) &&
          sameObject(event.to.parent, identity) &&
          event.to.rawNameBase64 === blob.claim.location.rawNameBase64,
      );
      requireFact(
        promotion?.kind === "promotion-observed",
        "Native blob physical parent has no observed generated promotion.",
      );
      const intent = [...events.values()].find(
        (event) =>
          event.kind === "promotion-intent" &&
          event.requestId === promotion.requestId &&
          event.attemptId === promotion.attemptId &&
          same(event.source, claim.file) &&
          same(event.destination, promotion.to),
      );
      requireFact(
        intent,
        "Native blob promotion lacks its exact preceding generated intent.",
      );
    }
    const known = knownBlobs.get(blob.claim.claimId);
    requireFact(
      !known || same(known, blob),
      "Native physical claim was rebound.",
    );
    const physicalKey = digest(blob.claim.object);
    const priorClaim = physicalClaims.get(physicalKey);
    requireFact(
      !priorClaim || priorClaim === blob.claim.claimId,
      "One native physical object has multiple full claim identifiers.",
    );
    knownBlobs.set(blob.claim.claimId, blob);
    physicalClaims.set(physicalKey, blob.claim.claimId);
  };
  for (const record of store.mixedRecords()) {
    const recordDigest = store.recordDigest(record);
    const requestId =
      record.kind === "native-host-deployment-intent"
        ? record.request.requestId
        : record.kind === "native-source-policy-install-intent"
          ? record.scope.requestId
          : record.kind === "candidate-reserved" ||
              record.kind === "publication-plan"
            ? record.binding.requestId
            : undefined;
    if (requestId !== undefined) {
      requireFact(
        !requestOwners.has(requestId),
        "A request identity has multiple generated or native owners.",
      );
      requestOwners.set(requestId, record.kind);
    }
    if (record.schemaVersion === 1) {
      events.set(recordDigest, record);
      continue;
    }
    if (record.kind === "native-copy-intent")
      recover(
        "journal-recovery-required",
        "Native acquisition is not implemented by this release.",
        record.scope.requestId,
        recordDigest,
      );
    if (
      record.kind === "native-host-deployment-intent" ||
      record.kind === "native-source-policy-install-intent"
    ) {
      requireFact(
        ++count <= 4096,
        "Native request catalog exceeds 4096 requests.",
      );
      const key =
        record.kind === "native-host-deployment-intent"
          ? recordDigest
          : record.scope.intentDigest;
      requireFact(!intents.has(key), "Native intent identity is duplicated.");
      requireFact(
        record.reservation.maximumAttempts === 3,
        "Native request does not reserve three attempts.",
      );
      if (record.kind === "native-host-deployment-intent")
        requireFact(
          same(record.expectedPriorRegistration, registration) &&
            record.request.expectedPriorRegistration ===
              (registration?.sha256 ?? null),
          "Host registration expected predecessor differs from retained history.",
        );
      else
        requireFact(
          record.planned.sha256 === digest(record.policy) &&
            record.planned.byteLength ===
              String(encodePublication(record.policy).byteLength) &&
            record.policy.releaseDigest === record.releaseDigest,
          "Policy intent bytes or release binding differs.",
        );
      intents.set(key, record);
    } else if (record.kind === "native-host-deployment-settled") {
      const prior = events.get(record.intentDigest);
      requireFact(
        prior?.kind === "native-host-deployment-intent",
        "Host registration settlement has no intent.",
      );
      requireFact(
        record.registration.sha256 === digest(prior.registration),
        "Host registration bytes differ from intent.",
      );
      owned(record.registration);
      registration = record.registration;
    } else if ("scope" in record) {
      const intent = intents.get(record.scope.intentDigest);
      requireFact(intent, "Native record has no preceding intent.");
      requireFact(
        same(record.scope, attemptScope(intent, record.scope.attemptNumber)),
        "Native attempt or intent scope differs.",
      );
      if (record.kind === "native-stage-reserved") {
        requireFact(
          !attempts.has(record.scope.attemptId),
          "Native attempt reservation is duplicated.",
        );
        attempts.add(record.scope.attemptId);
      } else
        requireFact(
          attempts.has(record.scope.attemptId),
          "Native operation lacks an attempt reservation.",
        );
      if ("binding" in record) {
        const expected = operationBinding(
          record.scope,
          record.binding.effect,
          record.binding.location,
          record.binding.plannedEffectDigest,
          record.binding.claimId,
        );
        requireFact(
          same(expected, record.binding),
          "Native operation binding differs from its frozen scope.",
        );
        const key = `${record.scope.attemptId}:${record.binding.operationId}:${record.kind}`;
        requireFact(!rows.has(key), "Native logical operation is duplicated.");
        rows.set(key, recordDigest);
      }
      switch (record.kind) {
        case "native-stage-reserved":
        case "native-attempt-retained":
          break;
        case "native-source-policy-generation-settled":
          requireFact(
            intent.kind === "native-source-policy-install-intent" &&
              record.policyIntentDigest === digest(intent) &&
              record.blob.sha256 === intent.planned.sha256 &&
              record.blob.byteLength === intent.planned.byteLength &&
              record.blob.evidenceId === intent.planned.evidenceId,
            "Policy generation differs from its intent.",
          );
          requireFact(
            record.blob.claim.claimId === record.binding.claimId &&
              same(record.blob.claim.location, record.binding.location),
            "Policy generation operation claim differs.",
          );
          owned(record.blob);
          break;
        case "native-source-policy-selector-intent": {
          requireFact(
            intent.kind === "native-source-policy-install-intent" &&
              record.policyIntentDigest === digest(intent),
            "Policy selector belongs to another intent.",
          );
          requireFact(
            intent.expectedPriorGeneration ===
              (record.priorGeneration?.sha256 ?? null),
            "Policy selector expected prior generation differs.",
          );
          const original = installationPredecessors.get(
            record.scope.intentDigest,
          ) ?? {
            prior: selected?.selector ?? null,
            priorGeneration: selected?.generation ?? null,
          };
          requireFact(
            same(record.prior, original.prior) &&
              same(record.priorGeneration, original.priorGeneration),
            "Policy selector predecessor physical ownership differs.",
          );
          installationPredecessors.set(record.scope.intentDigest, original);
          const generation = [...events.values()].find(
            (event) =>
              event.kind === "native-source-policy-generation-settled" &&
              same(event.scope, record.scope) &&
              same(event.blob, record.generation),
          );
          requireFact(
            generation,
            "Policy selector has no same-attempt generation settlement.",
          );
          owned(record.generation);
          if (record.prior) owned(record.prior);
          if (record.priorGeneration) owned(record.priorGeneration);
          break;
        }
        case "native-source-policy-selector-settled": {
          const prior = events.get(record.selectorIntentDigest);
          requireFact(
            prior?.kind === "native-source-policy-selector-intent" &&
              same(prior.scope, record.scope) &&
              same(prior.binding, record.binding) &&
              same(prior.generation, record.generation),
            "Policy selector settlement belongs to another attempt or intent.",
          );
          requireFact(
            record.selector.claim.claimId === record.binding.claimId &&
              same(record.selector.claim.location, record.binding.location),
            "Policy selector operation claim differs.",
          );
          owned(record.selector);
          selected = {
            selector: record.selector,
            generation: record.generation,
          };
          break;
        }
        case "native-source-policy-receipt-intent": {
          const prior = events.get(record.selectorSettledDigest);
          requireFact(
            intent.kind === "native-source-policy-install-intent" &&
              prior?.kind === "native-source-policy-selector-settled" &&
              same(prior.scope, record.scope) &&
              same(record.body.scope, record.scope) &&
              same(record.body.generation, prior.generation) &&
              same(record.body.selector, prior.selector) &&
              record.body.policyIntentDigest === digest(intent) &&
              record.body.deploymentDigest ===
                intent.policy.deploymentRegistrationDigest &&
              record.body.releaseDigest === intent.releaseDigest &&
              record.planned.sha256 === digest(record.body) &&
              record.planned.byteLength ===
                String(encodePublication(record.body).byteLength),
            "Policy installation receipt graph differs.",
          );
          break;
        }
        case "native-source-policy-receipt-settled": {
          const prior = events.get(record.receiptIntentDigest);
          requireFact(
            prior?.kind === "native-source-policy-receipt-intent" &&
              same(prior.scope, record.scope) &&
              same(prior.binding, record.binding) &&
              record.blob.sha256 === prior.planned.sha256 &&
              record.blob.byteLength === prior.planned.byteLength,
            "Policy receipt settlement differs.",
          );
          requireFact(
            record.blob.claim.claimId === record.binding.claimId &&
              same(record.blob.claim.location, record.binding.location),
            "Policy receipt operation claim differs.",
          );
          owned(record.blob);
          break;
        }
        default:
          recover(
            "journal-recovery-required",
            "Native record family is not implemented by this release.",
          );
      }
    } else
      recover("journal-recovery-required", "Unsupported native record family.");
    events.set(recordDigest, record);
  }
}

export function requirePendingOrder(
  store: PublicationStore,
  input: { requestId?: string; family?: "host-deployment" | "native-policy" },
): void {
  validateMixedHistory(store);
  const history = store.mixedRecords();
  const settled = new Set(
    history.flatMap((record) => {
      if (record.kind === "settled") return [record.requestId];
      if (record.kind === "generated-candidate-admitted")
        return history.flatMap((reservation) =>
          reservation.kind === "candidate-reserved" &&
          digest(reservation.binding) === record.createBindingDigest
            ? [reservation.binding.requestId]
            : [],
        );
      if (record.kind === "native-host-deployment-settled")
        return [record.intentDigest];
      if (record.kind === "native-source-policy-receipt-settled")
        return [record.scope.intentDigest];
      return [];
    }),
  );
  const pending = history.flatMap((record) => {
    if (
      record.kind === "candidate-reserved" ||
      record.kind === "publication-plan"
    )
      return settled.has(record.binding.requestId)
        ? []
        : [
            {
              family: "generated",
              requestId: record.binding.requestId,
              key: record.binding.requestId,
            },
          ];
    if (record.kind === "native-host-deployment-intent")
      return settled.has(digest(record))
        ? []
        : [
            {
              family: "host-deployment",
              requestId: record.request.requestId,
              key: digest(record),
            },
          ];
    if (record.kind === "native-source-policy-install-intent")
      return settled.has(record.scope.intentDigest)
        ? []
        : [
            {
              family: "native-policy",
              requestId: record.scope.requestId,
              key: record.scope.intentDigest,
            },
          ];
    return [];
  });
  const first = pending[0];
  if (
    !first ||
    (!input.family && pending.every((record) => record.family === "generated"))
  )
    return;
  if (first.family === input.family && first.requestId === input.requestId)
    return;
  recover(
    "uncertain-publication",
    "Earlier pending work must settle under its original request before this mutation.",
    first.requestId,
    first.key,
  );
}
