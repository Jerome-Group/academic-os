import { join } from "node:path";
import { digest, encodePublication, sha256 } from "./codec.js";
import { recover, refuse } from "./failure.js";
import type {
  HostInstallInput,
  HostRegistration,
  HostRegistrationInput,
  HostRegistrationIntent,
  InstallReceipt,
  OwnedBlob,
  Policy,
  PolicyInstallIntent,
  PolicySelector,
} from "./generated/native-source-contract-1.js";
import type {
  RecoveryRequired,
  Refused,
} from "./generated/publication-contract-1.js";
import { locator, observeHostDeployment } from "./host-deployment-inputs.js";
import type {
  ExclusionObservation,
  PublicationNative,
  ValidatedAccountAnchor,
} from "./native-contract.js";
import {
  operationBinding,
  requireNativeBridge,
} from "./native-policy-history.js";
import {
  appendOnce,
  deploymentSelectorName,
  historyName,
  location,
  persistImmutable,
  planned,
  policySelectorName,
  readOwned,
  replaceSelector,
  requireImmutableEligible,
  reserveSuffix,
  selectorBytes,
  strictDirectory,
  withAttempts,
} from "./native-policy-persistence.js";
import {
  emptyReservation,
  reserveNativePlan,
} from "./native-policy-reservation.js";
import { withPublicationOwner } from "./owner.js";
import {
  parseBytes,
  validateHostInstallInput,
  validateHostRegistration,
  validateHostRegistrationInput,
  validatePolicy,
  validatePolicySelector,
} from "./schema.js";
import {
  namespaceName,
  nativeEffect,
  nativeValue,
  type PublicationStore,
  sameObject,
} from "./store.js";

const trustedHostDeployment: unique symbol = Symbol("trusted-host-deployment");
export interface TrustedHostDeployment {
  readonly [trustedHostDeployment]: true;
}
class DeploymentCapability implements TrustedHostDeployment {
  readonly [trustedHostDeployment] = true;
  toJSON(): never {
    throw new Error("Trusted host deployment authority cannot be serialized.");
  }
}
const deployments = new WeakMap<
  object,
  { registration: HostRegistration; blob: OwnedBlob }
>();
type Failure = Refused | RecoveryRequired;

function installedRegistration(store: PublicationStore): {
  registration: HostRegistration;
  blob: OwnedBlob;
} {
  const settled = store
    .mixedRecords()
    .findLast((record) => record.kind === "native-host-deployment-settled");
  if (settled?.kind !== "native-host-deployment-settled")
    refuse(
      "unsafe-namespace",
      "No trusted host deployment registration is installed.",
    );
  const bytes = readOwned(
    store,
    store.namespace,
    deploymentSelectorName,
    settled.registration,
  );
  return {
    registration: parseBytes(bytes, validateHostRegistration),
    blob: settled.registration,
  };
}

export async function openInstalledHostDeployment(): Promise<
  | { kind: "trusted-host-deployment"; deployment: TrustedHostDeployment }
  | Failure
> {
  return withPublicationOwner({
    mutate: false,
    context: { exclusionPaths: [] },
    run(store) {
      const binding = installedRegistration(store);
      const value = new DeploymentCapability();
      deployments.set(value, binding);
      return { kind: "trusted-host-deployment" as const, deployment: value };
    },
  });
}

function selectedPolicy(
  store: PublicationStore,
): { selector: OwnedBlob; generation: OwnedBlob; body: PolicySelector } | null {
  const settled = store
    .mixedRecords()
    .findLast(
      (record) => record.kind === "native-source-policy-selector-settled",
    );
  if (settled?.kind !== "native-source-policy-selector-settled") {
    if (
      nativeValue(
        store.native.observeAt(store.namespace, store.name(policySelectorName)),
      ).kind !== "absent"
    )
      refuse(
        "unowned-output",
        "Unknown policy selector cannot be adopted from equal bytes.",
      );
    return null;
  }
  const bytes = readOwned(
    store,
    store.namespace,
    policySelectorName,
    settled.selector,
  );
  const body = parseBytes(bytes, validatePolicySelector);
  if (digest(body.generation) !== digest(settled.generation))
    recover(
      "journal-recovery-required",
      "Selected policy generation differs from its settlement.",
    );
  const generations = store.openDirectory(
    store.namespace,
    "native-source-policy",
    store.directoryClaim(store.namespace, "native-source-policy"),
  );
  readOwned(
    store,
    generations,
    `${settled.generation.sha256}.json`,
    settled.generation,
  );
  return { selector: settled.selector, generation: settled.generation, body };
}

function originalSelectorBytes(
  store: PublicationStore,
  name: string,
  blob: OwnedBlob,
): Uint8Array {
  const current = nativeValue(
    store.native.observeAt(store.namespace, store.name(name)),
  );
  if (
    current.kind === "present" &&
    sameObject(current.observation.object, blob.claim.object)
  )
    return readOwned(store, store.namespace, name, blob);
  const archivedName = historyName(name, blob);
  const archived = nativeValue(
    store.native.observeAt(store.namespace, store.name(archivedName)),
  );
  if (archived.kind === "present")
    return readOwned(store, store.namespace, archivedName, blob);
  const transfer = store
    .records()
    .find(
      (record) =>
        record.kind === "promotion-intent" &&
        sameObject(record.source.object, blob.claim.object) &&
        record.destination.rawNameBase64 ===
          Buffer.from(archivedName).toString("base64"),
    );
  if (transfer?.kind === "promotion-intent") {
    const attempt = store
      .mixedRecords()
      .find(
        (record) =>
          record.kind === "native-stage-reserved" &&
          `a${record.scope.attemptId}` === transfer.attemptId &&
          `n${record.scope.intentDigest}` === transfer.requestId,
      );
    if (attempt?.kind === "native-stage-reserved")
      return readOwned(
        store,
        store.namespace,
        `selector-${attempt.scope.attemptId}`,
        blob,
      );
  }
  return readOwned(store, store.namespace, archivedName, blob);
}

export async function registerHostDeployment(
  request: HostRegistrationInput,
): Promise<
  | {
      kind: "host-deployment-installed";
      registrationDigest: string;
      registration: OwnedBlob;
    }
  | Failure
> {
  if (!validateHostRegistrationInput(request))
    return {
      kind: "refused",
      code: "invalid-controls",
      evidence: ["Invalid deliberate host registration input."],
    };
  let initialBinding: string | undefined;
  let observed: ReturnType<typeof observeHostDeployment> | undefined;
  let retainedIntent: HostRegistrationIntent | undefined;
  let preparedIntent: HostRegistrationIntent | undefined;
  let deploymentRelease: string | undefined;
  const prepare = (
    native: PublicationNative,
    anchor: ValidatedAccountAnchor,
    releaseDigest: string,
  ): ExclusionObservation => {
    const fresh = observeHostDeployment({ native, anchor, request });
    if (initialBinding && initialBinding !== fresh.inputBindingDigest)
      refuse(
        "root-replaced",
        "Registered configuration or exclusions changed before owner entry.",
      );
    initialBinding = fresh.inputBindingDigest;
    observed = fresh;
    deploymentRelease = releaseDigest;
    return fresh.exclusions;
  };
  return withPublicationOwner({
    mutate: true,
    bootstrap: true,
    family: "host-deployment",
    requestId: request.requestId,
    context: { exclusionPaths: [] },
    prepare,
    completed(store) {
      const intent = store
        .mixedRecords()
        .find(
          (record) =>
            record.kind === "native-host-deployment-intent" &&
            record.request.requestId === request.requestId,
        );
      if (intent?.kind !== "native-host-deployment-intent") return undefined;
      if (digest(intent.request) !== digest(request))
        refuse("request-conflict", "Host registration request was rebound.");
      const completed = store
        .mixedRecords()
        .find(
          (record) =>
            record.kind === "native-host-deployment-settled" &&
            record.intentDigest === digest(intent),
        );
      if (completed?.kind !== "native-host-deployment-settled")
        return undefined;
      originalSelectorBytes(
        store,
        deploymentSelectorName,
        completed.registration,
      );
      return {
        kind: "host-deployment-installed" as const,
        registrationDigest: completed.registration.sha256,
        registration: completed.registration,
      };
    },
    validateBeforeSync(store) {
      const existing = store
        .mixedRecords()
        .find(
          (record) =>
            record.kind === "native-host-deployment-intent" &&
            record.request.requestId === request.requestId,
        );
      if (existing?.kind === "native-host-deployment-intent")
        retainedIntent = existing;
      if (
        existing?.kind === "native-host-deployment-intent" &&
        (digest(existing.request) !== digest(request) ||
          existing.inputBindingDigest !== observed?.inputBindingDigest)
      )
        refuse(
          "request-conflict",
          "Host registration request or observed deployment inputs changed.",
        );
      if (!retainedIntent) {
        if (!observed || !deploymentRelease)
          throw new Error("Prepared registration observations are absent.");
        const current = store
          .mixedRecords()
          .findLast(
            (record) => record.kind === "native-host-deployment-settled",
          );
        if (current?.kind === "native-host-deployment-settled") {
          readOwned(
            store,
            store.namespace,
            deploymentSelectorName,
            current.registration,
          );
          if (request.expectedPriorRegistration !== current.registration.sha256)
            refuse("stale-head", "Expected prior host registration differs.");
        } else if (
          request.expectedPriorRegistration !== null ||
          nativeValue(
            store.native.observeAt(
              store.namespace,
              store.name(deploymentSelectorName),
            ),
          ).kind !== "absent"
        )
          refuse(
            "unowned-output",
            "Host registration expected absence or ownership differs.",
          );
        const prior =
          current?.kind === "native-host-deployment-settled"
            ? current.registration
            : null;
        const template: HostRegistrationIntent = {
          schemaVersion: 2,
          kind: "native-host-deployment-intent",
          request,
          registration: observed.registration,
          expectedPriorRegistration: prior,
          inputBindingDigest: observed.inputBindingDigest,
          reservation: emptyReservation,
          releaseDigest: deploymentRelease,
        };
        preparedIntent = {
          ...template,
          reservation: reserveNativePlan(template),
        };
        requireNativeBridge(store, digest(preparedIntent));
        const bytes = encodePublication(observed.registration);
        requireImmutableEligible(
          store,
          "host-deployments",
          `${sha256(bytes)}.json`,
          bytes,
        );
      }
    },
    run(store, releaseDigest) {
      if (!observed)
        throw new Error("Host deployment observations are absent.");
      const existing =
        retainedIntent ??
        store
          .mixedRecords()
          .find(
            (record) =>
              record.kind === "native-host-deployment-intent" &&
              record.request.requestId === request.requestId,
          );
      let intent: HostRegistrationIntent;
      if (existing?.kind === "native-host-deployment-intent") {
        intent = existing;
        if (
          digest(intent.request) !== digest(request) ||
          intent.releaseDigest !== releaseDigest ||
          intent.inputBindingDigest !== observed.inputBindingDigest
        )
          refuse(
            "request-conflict",
            "Host registration cannot resume with changed inputs or release.",
          );
        const completed = store
          .mixedRecords()
          .find(
            (record) =>
              record.kind === "native-host-deployment-settled" &&
              record.intentDigest === digest(intent),
          );
        if (completed?.kind === "native-host-deployment-settled") {
          originalSelectorBytes(
            store,
            deploymentSelectorName,
            completed.registration,
          );
          return {
            kind: "host-deployment-installed" as const,
            registrationDigest: completed.registration.sha256,
            registration: completed.registration,
          };
        }
      } else {
        const current = store
          .mixedRecords()
          .findLast(
            (record) => record.kind === "native-host-deployment-settled",
          );
        const prior =
          current?.kind === "native-host-deployment-settled"
            ? current.registration
            : null;
        if ((prior?.sha256 ?? null) !== request.expectedPriorRegistration)
          refuse(
            "stale-head",
            "Expected prior host deployment registration differs.",
          );
        const template: HostRegistrationIntent = {
          schemaVersion: 2,
          kind: "native-host-deployment-intent",
          request,
          registration: observed.registration,
          expectedPriorRegistration: prior,
          inputBindingDigest: observed.inputBindingDigest,
          reservation: emptyReservation,
          releaseDigest,
        };
        intent = preparedIntent ?? {
          ...template,
          reservation: reserveNativePlan(template),
        };
        reserveSuffix(store, intent.reservation, intent);
        store.append(intent);
      }
      store.beforeMutation(() =>
        reserveSuffix(store, intent.reservation, intent),
      );
      return withAttempts(store, intent, (scope) => {
        const bytes = encodePublication(intent.registration);
        if (bytes.byteLength > 1048576)
          refuse(
            "invalid-controls",
            "Host deployment registration exceeds 1 MiB.",
          );
        const generations = strictDirectory(store, "host-deployments", scope);
        persistImmutable(
          store,
          scope,
          generations,
          `${sha256(bytes)}.json`,
          bytes,
          "host-deployment",
          "host-deployment/1",
        );
        const registration = replaceSelector(
          store,
          scope,
          deploymentSelectorName,
          bytes,
          intent.expectedPriorRegistration,
        );
        appendOnce(store, {
          schemaVersion: 2,
          kind: "native-host-deployment-settled",
          intentDigest: digest(intent),
          registration,
          fileBarrier: true,
          parentBarrier: true,
        });
        return {
          kind: "host-deployment-installed" as const,
          registrationDigest: registration.sha256,
          registration,
        };
      });
    },
  });
}

function readCompletedInstallation(
  store: PublicationStore,
  intent: PolicyInstallIntent,
): InstallReceipt | undefined {
  const completed = store
    .mixedRecords()
    .find(
      (record) =>
        record.kind === "native-source-policy-receipt-settled" &&
        record.scope.intentDigest === intent.scope.intentDigest,
    );
  if (completed?.kind === "native-source-policy-receipt-settled") {
    const body = store
      .mixedRecords()
      .find(
        (record) =>
          record.kind === "native-source-policy-receipt-intent" &&
          digest(record) === completed.receiptIntentDigest,
      );
    if (body?.kind !== "native-source-policy-receipt-intent")
      recover(
        "journal-recovery-required",
        "Historical installation receipt has no intent.",
      );
    const receipts = store.openDirectory(
      store.namespace,
      "native-policy-receipts",
      store.directoryClaim(store.namespace, "native-policy-receipts"),
    );
    readOwned(store, receipts, `${digest(intent)}.json`, completed.blob);
    originalSelectorBytes(store, policySelectorName, body.body.selector);
    const generations = store.openDirectory(
      store.namespace,
      "native-source-policy",
      store.directoryClaim(store.namespace, "native-source-policy"),
    );
    readOwned(
      store,
      generations,
      `${intent.planned.sha256}.json`,
      body.body.generation,
    );
    return body.body;
  }
  return undefined;
}

function retainedPolicyRequest(intent: PolicyInstallIntent): HostInstallInput {
  const request = {
    requestId: intent.scope.requestId,
    deploymentRegistrationDigest: intent.policy.deploymentRegistrationDigest,
    expectedPriorGeneration: intent.expectedPriorGeneration,
    slots: intent.policy.slots.map((slot) => ({
      sourceKey: slot.sourceKey,
      enclosureLocatorBase64: slot.enclosure.locatorBase64,
      snapshotLocatorBase64: slot.snapshot.locatorBase64,
    })),
  };
  if (!validateHostInstallInput(request))
    recover(
      "journal-recovery-required",
      "Retained policy input differs from its closed schema.",
    );
  return request;
}

export async function installNativeSourcePolicy(input: {
  deployment: TrustedHostDeployment;
  request: HostInstallInput;
}): Promise<InstallReceipt | Failure> {
  const authority =
    typeof input.deployment === "object" && input.deployment !== null
      ? deployments.get(input.deployment)
      : undefined;
  if (!authority || !validateHostInstallInput(input.request))
    return {
      kind: "refused",
      code: "invalid-controls",
      evidence: [
        "Trusted installed host deployment and closed policy input are required.",
      ],
    };
  const request = input.request;
  if (request.deploymentRegistrationDigest !== authority.blob.sha256)
    return {
      kind: "refused",
      code: "request-conflict",
      evidence: ["Policy input names another installed host registration."],
    };
  if (
    new Set(request.slots.map((slot) => slot.sourceKey)).size !==
    request.slots.length
  )
    return {
      kind: "refused",
      code: "invalid-controls",
      evidence: ["Policy source keys must be unique."],
    };
  let policy: Policy | undefined;
  let preparedPolicyIntent: PolicyInstallIntent | undefined;
  let initialBinding: string | undefined;
  const prepare = (
    native: PublicationNative,
    anchor: ValidatedAccountAnchor,
    releaseDigest: string,
  ) => {
    const fixed = join(
      anchor.canonicalAnchorPath,
      namespaceName,
      deploymentSelectorName,
    );
    const observedRegistration = nativeValue(
      native.readDeploymentFile({ anchor, locator: Buffer.from(fixed) }),
    );
    if (sha256(observedRegistration.bytes) !== authority.blob.sha256)
      refuse("root-replaced", "Installed host deployment changed.");
    const registration = parseBytes(
      observedRegistration.bytes,
      validateHostRegistration,
    );
    const observed = observeHostDeployment({
      native,
      anchor,
      request: registration,
    });
    if (digest(observed.registration) !== digest(registration))
      refuse(
        "root-replaced",
        "Registered configuration, account or exclusions changed.",
      );
    const slots = nativeValue(
      native.observePolicySlots({
        anchor,
        slots: request.slots.map((slot) => ({
          enclosure: locator(slot.enclosureLocatorBase64),
          snapshot: locator(slot.snapshotLocatorBase64),
        })),
      }),
    );
    const bindings = slots.map((slot, index) => {
      const requested = request.slots[index];
      const enclosure = slot.enclosure.components.at(-1),
        snapshot = slot.snapshot.components.at(-1);
      if (!requested || !enclosure || !snapshot)
        refuse("unsafe-namespace", "Policy source ancestry is absent.");
      return {
        sourceKey: requested.sourceKey,
        enclosure: {
          locatorBase64: slot.enclosure.locatorBase64,
          object: enclosure.object,
          ancestryDigest: digest({
            locatorBase64: slot.enclosure.locatorBase64,
            signature: slot.enclosure.signature,
          }),
        },
        snapshot: {
          locatorBase64: slot.snapshot.locatorBase64,
          object: snapshot.object,
          ancestryDigest: digest({
            locatorBase64: slot.snapshot.locatorBase64,
            signature: slot.snapshot.signature,
          }),
        },
      };
    });
    const fresh = {
      schema: "native-source-policy/1",
      hostAccountDigest: digest(anchor.host),
      deploymentRegistrationDigest: authority.blob.sha256,
      configurationSetDigest: registration.configurationSetDigest,
      exclusionSetDigest: registration.exclusionSetDigest,
      slots: bindings,
      releaseDigest,
      preservationPolicy: "darwin-native-provenance-accounted/1",
      coverage: "registered-deployments-only",
      quiescence: "cooperating-private-input-required",
    };
    if (!validatePolicy(fresh))
      refuse(
        "invalid-controls",
        "Observed policy differs from its closed schema.",
      );
    const bytes = encodePublication(fresh);
    if (bytes.byteLength > 1048576)
      refuse(
        "invalid-controls",
        "Native-source policy exceeds 1 MiB before effects.",
      );
    if (initialBinding && initialBinding !== sha256(bytes))
      refuse("root-replaced", "Policy inputs changed before owner entry.");
    initialBinding = sha256(bytes);
    policy = fresh;
    return observed.exclusions;
  };
  return withPublicationOwner({
    mutate: true,
    family: "native-policy",
    requestId: request.requestId,
    context: { exclusionPaths: [] },
    prepare,
    completed(store) {
      const intent = store
        .mixedRecords()
        .find(
          (record) =>
            record.kind === "native-source-policy-install-intent" &&
            record.scope.requestId === request.requestId,
        );
      if (intent?.kind !== "native-source-policy-install-intent")
        return undefined;
      if (digest(retainedPolicyRequest(intent)) !== digest(request))
        refuse("request-conflict", "Policy request changed its frozen input.");
      return readCompletedInstallation(store, intent);
    },
    validateBeforeSync(store) {
      const installed = installedRegistration(store);
      if (digest(installed.blob) !== digest(authority.blob))
        refuse(
          "root-replaced",
          "Host deployment registration physical ownership changed.",
        );
      const prior = store
        .mixedRecords()
        .find(
          (record) =>
            record.kind === "native-source-policy-install-intent" &&
            record.scope.requestId === request.requestId,
        );
      if (!prior) {
        if (!policy)
          throw new Error("Prepared policy observations are absent.");
        const selected = selectedPolicy(store);
        if (
          (selected?.generation.sha256 ?? null) !==
          request.expectedPriorGeneration
        )
          refuse("stale-head", "Expected prior policy generation differs.");
        const bytes = encodePublication(policy),
          plan = planned(bytes, "policy", "native-policy/1");
        const scope = {
          requestId: request.requestId,
          candidateId: `policy:${plan.sha256}`,
          intentDigest: digest({ request, policy }),
        };
        const template: PolicyInstallIntent = {
          schemaVersion: 2,
          kind: "native-source-policy-install-intent",
          scope,
          policy,
          planned: plan,
          expectedPriorGeneration: request.expectedPriorGeneration,
          reservation: emptyReservation,
          releaseDigest: policy.releaseDigest,
        };
        preparedPolicyIntent = {
          ...template,
          reservation: reserveNativePlan(template),
        };
        requireNativeBridge(store, scope.intentDigest);
        requireImmutableEligible(
          store,
          "native-source-policy",
          `${plan.sha256}.json`,
          bytes,
        );
      }
    },
    run(store, releaseDigest) {
      if (!policy) throw new Error("Policy observations are absent.");
      const existing = store
        .mixedRecords()
        .find(
          (record) =>
            record.kind === "native-source-policy-install-intent" &&
            record.scope.requestId === request.requestId,
        );
      let intent: PolicyInstallIntent;
      if (existing?.kind === "native-source-policy-install-intent") {
        intent = existing;
        if (
          digest(intent.policy) !== digest(policy) ||
          intent.expectedPriorGeneration !== request.expectedPriorGeneration ||
          intent.releaseDigest !== releaseDigest
        )
          refuse(
            "request-conflict",
            "Policy retry changed its frozen policy, expected prior generation or release.",
          );
        const completed = readCompletedInstallation(store, intent);
        if (completed) return completed;
      } else {
        const bytes = encodePublication(policy),
          plan = planned(bytes, "policy", "native-policy/1");
        const scope = {
          requestId: request.requestId,
          candidateId: `policy:${plan.sha256}`,
          intentDigest: digest({ request, policy }),
        };
        const template: PolicyInstallIntent = {
          schemaVersion: 2,
          kind: "native-source-policy-install-intent",
          scope,
          policy,
          planned: plan,
          expectedPriorGeneration: request.expectedPriorGeneration,
          reservation: emptyReservation,
          releaseDigest,
        };
        intent = preparedPolicyIntent ?? {
          ...template,
          reservation: reserveNativePlan(template),
        };
        reserveSuffix(store, intent.reservation, intent);
        store.append(intent);
      }
      store.beforeMutation(() =>
        reserveSuffix(store, intent.reservation, intent),
      );
      return withAttempts(store, intent, (scope) => {
        const generations = strictDirectory(
          store,
          "native-source-policy",
          scope,
        );
        const generation = persistImmutable(
          store,
          scope,
          generations,
          `${intent.planned.sha256}.json`,
          encodePublication(intent.policy),
          "policy",
          "native-policy/1",
        );
        appendOnce(store, {
          schemaVersion: 2,
          kind: "native-source-policy-generation-settled",
          scope,
          binding: operationBinding(
            scope,
            "install-policy",
            generation.claim.location,
            intent.planned.sha256,
            generation.claim.claimId,
          ),
          policyIntentDigest: digest(intent),
          blob: generation,
          fileBarrier: true,
          parentBarrier: true,
        });
        const retainedSelector = store
          .mixedRecords()
          .find(
            (record) =>
              record.kind === "native-source-policy-selector-intent" &&
              record.scope.attemptId === scope.attemptId,
          );
        const earlierSelector = store
          .mixedRecords()
          .find(
            (record) =>
              record.kind === "native-source-policy-selector-intent" &&
              record.scope.intentDigest === scope.intentDigest,
          );
        const earlierSelected = store
          .mixedRecords()
          .findLast(
            (record) =>
              record.kind === "native-source-policy-selector-settled" &&
              record.scope.intentDigest === scope.intentDigest,
          );
        const reused =
          earlierSelected?.kind === "native-source-policy-selector-settled"
            ? earlierSelected
            : null;
        const selected =
          retainedSelector?.kind === "native-source-policy-selector-intent" ||
          reused
            ? null
            : selectedPolicy(store);
        const target = location(store, store.namespace, policySelectorName);
        const binding = operationBinding(
          scope,
          "policy-selector",
          target,
          digest(generation),
          reused?.selector.claim.claimId,
        );
        const original =
          reused &&
          earlierSelector?.kind === "native-source-policy-selector-intent"
            ? earlierSelector
            : null;
        const selectorIntent =
          retainedSelector?.kind === "native-source-policy-selector-intent"
            ? retainedSelector
            : appendOnce(store, {
                schemaVersion: 2,
                kind: "native-source-policy-selector-intent",
                scope,
                binding,
                policyIntentDigest: digest(intent),
                prior: original?.prior ?? selected?.selector ?? null,
                priorGeneration:
                  original?.priorGeneration ?? selected?.generation ?? null,
                generation,
              });
        let selector: OwnedBlob;
        if (reused) {
          if (selectorIntent.prior)
            originalSelectorBytes(
              store,
              policySelectorName,
              selectorIntent.prior,
            );
          const bytes = readOwned(
            store,
            store.namespace,
            policySelectorName,
            reused.selector,
          );
          if (
            sha256(bytes) !==
            sha256(selectorBytes(generation, intent.policy.hostAccountDigest))
          )
            recover(
              "uncertain-claim",
              "Retained selector differs from this installation's exact generation.",
            );
          nativeEffect(
            store.native.syncFile({
              interval: store.mutating(),
              file: store.openFile(store.namespace, policySelectorName),
            }),
            "durability-unavailable",
          );
          store.syncDirectory(store.namespace);
          selector = reused.selector;
        } else
          selector = replaceSelector(
            store,
            scope,
            policySelectorName,
            selectorBytes(generation, intent.policy.hostAccountDigest),
            selectorIntent.prior,
            selectorIntent.binding.claimId,
          );
        const selectedRow = appendOnce(store, {
          schemaVersion: 2,
          kind: "native-source-policy-selector-settled",
          scope,
          binding: selectorIntent.binding,
          selectorIntentDigest: digest(selectorIntent),
          selector,
          generation,
          parentBarrier: true,
        });
        const receipt: InstallReceipt = {
          schema: "native-source-policy-install-receipt/1",
          scope,
          generation,
          selector,
          policyIntentDigest: digest(intent),
          deploymentDigest: intent.policy.deploymentRegistrationDigest,
          coverage: "registered-deployments-only",
          quiescence: "cooperating-private-input-required",
          releaseDigest,
        };
        const bytes = encodePublication(receipt);
        if (bytes.byteLength > 65536)
          refuse(
            "invalid-controls",
            "Policy installation receipt exceeds 64 KiB.",
          );
        const receipts = strictDirectory(
          store,
          "native-policy-receipts",
          scope,
        );
        const receiptBinding = operationBinding(
          scope,
          "install-receipt",
          location(store, receipts, `${digest(intent)}.json`),
          sha256(bytes),
        );
        const receiptIntent = appendOnce(store, {
          schemaVersion: 2,
          kind: "native-source-policy-receipt-intent",
          scope,
          binding: receiptBinding,
          selectorSettledDigest: digest(selectedRow),
          planned: planned(
            bytes,
            "installation-receipt",
            "native-policy-install-receipt/1",
          ),
          body: receipt,
        });
        const output = persistImmutable(
          store,
          scope,
          receipts,
          `${digest(intent)}.json`,
          bytes,
          "installation-receipt",
          "native-policy-install-receipt/1",
        );
        const blob = {
          ...output,
          claim: { ...output.claim, claimId: receiptBinding.claimId },
        };
        appendOnce(store, {
          schemaVersion: 2,
          kind: "native-source-policy-receipt-settled",
          scope,
          binding: receiptBinding,
          receiptIntentDigest: digest(receiptIntent),
          blob,
          fileBarrier: true,
          parentBarrier: true,
        });
        readOwned(store, receipts, `${digest(intent)}.json`, blob);
        return receipt;
      });
    },
  });
}

export async function retryNativeSourcePolicy(input: {
  deployment: TrustedHostDeployment;
  requestId: string;
}): Promise<InstallReceipt | Failure> {
  if (
    typeof input.deployment !== "object" ||
    input.deployment === null ||
    !deployments.has(input.deployment)
  )
    return {
      kind: "refused",
      code: "invalid-controls",
      evidence: ["Trusted installed host deployment is required."],
    };
  const retained = await withPublicationOwner({
    mutate: false,
    requestId: input.requestId,
    requestKind: "native-source-policy-install-intent",
    context: { exclusionPaths: [] },
    run(store) {
      const intent = store
        .mixedRecords()
        .find(
          (record) =>
            record.kind === "native-source-policy-install-intent" &&
            record.scope.requestId === input.requestId,
        );
      if (intent?.kind !== "native-source-policy-install-intent")
        refuse("unknown-candidate", "Policy install request is absent.");
      const receipt = readCompletedInstallation(store, intent);
      if (receipt) return { kind: "completed-policy-input" as const, receipt };
      return {
        kind: "retained-policy-input" as const,
        request: {
          requestId: input.requestId,
          deploymentRegistrationDigest:
            intent.policy.deploymentRegistrationDigest,
          expectedPriorGeneration: intent.expectedPriorGeneration,
          slots: intent.policy.slots.map((slot) => ({
            sourceKey: slot.sourceKey,
            enclosureLocatorBase64: slot.enclosure.locatorBase64,
            snapshotLocatorBase64: slot.snapshot.locatorBase64,
          })),
        },
      };
    },
  });
  if (retained.kind === "completed-policy-input") return retained.receipt;
  if (retained.kind !== "retained-policy-input") return retained;
  if (!validateHostInstallInput(retained.request))
    return {
      kind: "refused",
      code: "invalid-controls",
      evidence: ["Retained policy input differs from its closed schema."],
    };
  return installNativeSourcePolicy({
    deployment: input.deployment,
    request: retained.request,
  });
}
