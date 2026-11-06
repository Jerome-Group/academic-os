import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import {
  validateHostFailure,
  validateHostPolicyResult,
  validateHostRegistrationResult,
} from "../../src/controls-publication/schema.js";
import { fixture, raw } from "./native-policy-fixture.js";

it("validates actual host owner refusals and recovery through frozen publisher error shapes without inventing native pending scope", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("host-result-boundary");
  context.diagnostic(`Retained host-result boundary fixture ${f.root}`);
  const unavailable = await f.run("install-native-source-policy", {
    requestId: "unavailable",
    deploymentRegistrationDigest: "0".repeat(64),
    expectedPriorGeneration: null,
    slots: [
      {
        sourceKey: "private-one",
        enclosureLocatorBase64: raw(f.enclosure),
        snapshotLocatorBase64: raw(f.source),
      },
    ],
  });
  assert.equal(unavailable.value.code, "unknown-candidate");
  assert.equal(validateHostFailure(unavailable.value), true);
  assert.equal(validateHostPolicyResult(unavailable.value), true);
  assert.equal("pending" in unavailable.value, false);
  const registered = await f.run("register", f.registrationInput);
  assert.equal(registered.status, 0, JSON.stringify(registered.value));
  assert.equal(validateHostRegistrationResult(registered.value), true);
  assert.equal(
    validateHostRegistrationResult({
      ...registered.value,
      arbitraryAuthority: true,
    }),
    false,
  );
  const requestId = `部署${"x".repeat(120)}`;
  const input = {
    requestId,
    deploymentRegistrationDigest: registered.value.registrationDigest,
    expectedPriorGeneration: null,
    slots: [
      {
        sourceKey: "private-one",
        enclosureLocatorBase64: raw(f.enclosure),
        snapshotLocatorBase64: raw(f.source),
      },
    ],
  };
  await writeFile(
    f.checkpoint,
    JSON.stringify({
      edge: "before-create-directory",
      kind: "native-stage-reserved",
      action: "throw",
    }),
  );
  const recovery = await f.run("install-native-source-policy", input);
  assert.equal(recovery.value.kind, "recovery-required");
  assert.equal(
    validateHostPolicyResult(recovery.value),
    true,
    JSON.stringify(recovery.value),
  );
  assert.equal(recovery.value.requestId, null);
  assert.match(JSON.stringify(recovery.value), new RegExp(requestId, "u"));
  assert.equal("pending" in recovery.value, false);
  assert.equal(
    validateHostPolicyResult({
      ...recovery.value,
      pending: { family: "native-copy", scope: {} },
    }),
    false,
  );
  await unlink(f.checkpoint);
  const completed = await f.run("retry-native-source-policy", requestId);
  assert.equal(completed.status, 0, JSON.stringify(completed.value));
  assert.equal(validateHostPolicyResult(completed.value), true);
  const history = await f.records();
  assert.equal(
    history.some(
      (record) =>
        record.kind === "native-source-policy-install-intent" &&
        record.scope.requestId === requestId,
    ),
    true,
  );
  const native = JSON.parse(
    await readFile(
      "src/controls-publication/schemas/native-source-contract-1.schema.json",
      "utf8",
    ),
  );
  assert.deepEqual(native.definitions.HostFailure.oneOf, [
    { $ref: "urn:academic-os:publication-contract:1#/definitions/Refused" },
    {
      $ref: "urn:academic-os:publication-contract:1#/definitions/RecoveryRequired",
    },
  ]);
  await writeFile(
    join(f.root, "host-result-proof.json"),
    JSON.stringify(
      {
        unavailable: unavailable.value,
        registration: registered.value,
        recovery: recovery.value,
        completed: completed.value,
        nativePendingInvented: false,
      },
      null,
      2,
    ),
  );
});
