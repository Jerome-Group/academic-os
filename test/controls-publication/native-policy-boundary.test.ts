import assert from "node:assert/strict";
import { cp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import {
  encodePublication,
  sha256,
} from "../../src/controls-publication/codec.js";
import {
  parseBytes,
  validateMixedEvent,
} from "../../src/controls-publication/schema.js";
import { fixture, repository } from "./native-policy-fixture.js";
import { bindFixtureRuntime } from "./runtime-fixture.js";

it("refuses changed installed transitive dependency and non-JavaScript inputs before account entry and restores exact policy retry", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("dependency-boundary");
  context.diagnostic(`Retained dependency boundary fixture ${f.root}`);
  await unlink(join(f.host, "node_modules"));
  await cp(join(repository, "node_modules"), join(f.host, "node_modules"), {
    recursive: true,
  });
  await bindFixtureRuntime(f.host, join(f.host, "src/controls-publication"));
  const request = await f.request();
  const before = await readFile(f.ledger);
  const path = join(f.host, "node_modules/ajv/dist/ajv.js");
  const original = await readFile(path);
  await writeFile(
    f.checkpoint,
    JSON.stringify({ edge: "before-handle-guard", action: "throw" }),
  );
  await writeFile(
    path,
    Buffer.concat([
      original,
      Buffer.from("\n// retained installed-dependency mutation\n"),
    ]),
  );
  const changed = await f.run("install-native-source-policy", request);
  const ownerEntered = await stat(join(f.root, "fault-hit.json")).then(
    () => true,
    () => false,
  );
  const after = await readFile(f.ledger);
  await writeFile(
    join(f.root, "dependency-boundary-result.json"),
    JSON.stringify(
      {
        changed: changed.value,
        ownerEntered,
        ledgerUnchanged: before.equals(after),
        commands: f.commands,
      },
      null,
      2,
    ),
  );
  await writeFile(path, original);
  assert.notEqual(changed.status, 0);
  assert.equal(
    ownerEntered,
    false,
    "changed dependency reached the account owner",
  );
  assert.deepEqual(after, before);
  await unlink(f.checkpoint);
  const installed = await f.run("install-native-source-policy", request);
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  const retried = await f.run("retry-native-source-policy", request.requestId);
  assert.deepEqual(retried.value, installed.value);
});

it("rejects a canonically rechained native blob false filename before exact registration retry or unrelated generated creation", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("claim-location-boundary");
  context.diagnostic(`Retained full claim location fixture ${f.root}`);
  await f.register();
  const before = await readFile(f.ledger);
  const rows = before
    .toString()
    .trimEnd()
    .split("\n")
    .map((line) => parseBytes(Buffer.from(line), validateMixedEvent));
  const settled = rows.findLast(
    (row) => row.record.kind === "native-host-deployment-settled",
  );
  assert.ok(settled?.record.kind === "native-host-deployment-settled");
  settled.record.registration.claim.location.rawNameBase64 = Buffer.from(
    "not-the-claimed-registration.json",
  ).toString("base64");
  let previous: string | null = null;
  const corrupted = Buffer.concat(
    rows.map((row, sequence) => {
      const bytes = encodePublication({
        ...row,
        sequence,
        previousEventByteSha256: previous,
      });
      previous = sha256(bytes);
      return Buffer.concat([bytes, Buffer.from("\n")]);
    }),
  );
  await writeFile(join(f.root, "ledger-before-location-change.jsonl"), before);
  await writeFile(f.ledger, corrupted);
  const retry = await f.run("register", f.registrationInput);
  const afterRetry = await readFile(f.ledger);
  const generated = f.command([
    join(f.host, "publication.mjs"),
    "create-generated-candidate",
    "--request",
    "after-invalid-location",
    "--identity",
    f.identityPath,
  ]);
  const afterGenerated = await readFile(f.ledger);
  await writeFile(
    join(f.root, "claim-location-boundary-result.json"),
    JSON.stringify(
      {
        retry: retry.value,
        generated: generated.stdout,
        retryLedgerUnchanged: afterRetry.equals(corrupted),
        generatedLedgerUnchanged: afterGenerated.equals(corrupted),
        commands: f.commands,
      },
      null,
      2,
    ),
  );
  assert.notEqual(retry.status, 0, "false filename accepted by exact retry");
  assert.notEqual(
    generated.status,
    0,
    "false filename accepted by unrelated mutation",
  );
  assert.deepEqual(afterRetry, corrupted);
  assert.deepEqual(afterGenerated, corrupted);
});
