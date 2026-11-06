import assert from "node:assert/strict";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { isRecord } from "../../src/conformance/value-shape.js";
import { digest } from "../../src/controls-publication/codec.js";
import { publicationFixture } from "./fixtures.js";
import { fixture, raw } from "./native-policy-fixture.js";

it("replays completed generated and native output ahead of unrelated pending installation without append or sync", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("completed-order");
  context.diagnostic(`Retained completed-order fixture ${f.root}`);
  const input = await f.request();
  const createArgs = [
    join(f.host, "publication.mjs"),
    "create-generated-candidate",
    "--request",
    "completed-create",
    "--identity",
    f.identityPath,
  ];
  const created = f.command(createArgs);
  assert.equal(created.status, 0, created.stdout + created.stderr);
  const candidate: unknown = JSON.parse(created.stdout);
  assert.ok(
    isRecord(candidate) &&
      isRecord(candidate.candidate) &&
      typeof candidate.candidate.candidateId === "string",
  );
  const bundle = join(f.root, "inputs/bundle.json");
  await writeFile(bundle, publicationFixture().bundleBytes);
  const publishArgs = [
    join(f.host, "publication.mjs"),
    "publish-generation",
    "--candidate",
    candidate.candidate.candidateId,
    "--request",
    "completed-publish",
    "--bundle",
    bundle,
    "--expect-absent",
  ];
  const published = f.command(publishArgs);
  assert.equal(published.status, 0, published.stdout + published.stderr);
  const installed = await f.run("install-native-source-policy", input);
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  assert.ok(isRecord(installed.value.generation));
  await writeFile(
    f.checkpoint,
    JSON.stringify({ edge: "after-policy-selector-swap", action: "throw" }),
  );
  const pending = await f.run("install-native-source-policy", {
    ...input,
    requestId: "pending-policy",
    expectedPriorGeneration: installed.value.generation.sha256,
    slots: [{ ...input.slots[0], sourceKey: "pending-slot" }],
  });
  assert.notEqual(pending.status, 0);
  await unlink(f.checkpoint);
  const bytes = await readFile(f.ledger);
  await writeFile(
    f.checkpoint,
    JSON.stringify({ edge: "before-file-sync", action: "throw" }),
  );
  const createRetry = f.command(createArgs),
    publishRetry = f.command(publishArgs);
  assert.equal(createRetry.status, 0, createRetry.stdout + createRetry.stderr);
  assert.deepEqual(JSON.parse(createRetry.stdout), candidate);
  assert.equal(
    publishRetry.status,
    0,
    publishRetry.stdout + publishRetry.stderr,
  );
  const publication: unknown = JSON.parse(published.stdout),
    repeated: unknown = JSON.parse(publishRetry.stdout);
  assert.ok(isRecord(publication) && isRecord(repeated));
  assert.deepEqual(repeated.receipt, publication.receipt);
  assert.equal(repeated.replayed, true);
  const historical = await f.run(
    "retry-native-source-policy",
    input.requestId,
    f.extracted,
  );
  assert.equal(historical.status, 0, JSON.stringify(historical.value));
  assert.deepEqual(historical.value, installed.value);
  const registration = await f.run("register", f.registrationInput);
  assert.equal(registration.status, 0, JSON.stringify(registration.value));
  assert.deepEqual(await readFile(f.ledger), bytes);
  const blocked = f.command([
    ...createArgs.slice(0, 3),
    "fresh-create",
    ...createArgs.slice(4),
  ]);
  assert.notEqual(blocked.status, 0);
  const blockedValue: unknown = JSON.parse(blocked.stdout);
  assert.ok(isRecord(blockedValue));
  assert.equal(blockedValue.requestId, "pending-policy");
  assert.deepEqual(await readFile(f.ledger), bytes);
  await writeFile(
    f.identityPath,
    publicationFixture("Changed identity").identityBytes,
  );
  const changed = f.command(createArgs);
  const changedValue: unknown = JSON.parse(changed.stdout);
  assert.ok(isRecord(changedValue));
  assert.equal(changedValue.code, "request-conflict");
  assert.deepEqual(await readFile(f.ledger), bytes);
});

it("refuses cross-family and internal bridge request reuse before any new retained state", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("request-ownership");
  context.diagnostic(`Retained request-ownership fixture ${f.root}`);
  const input = await f.request();
  const created = f.command([
    join(f.host, "publication.mjs"),
    "create-generated-candidate",
    "--request",
    "create-one",
    "--identity",
    f.identityPath,
  ]);
  assert.equal(created.status, 0, created.stdout + created.stderr);
  const value: unknown = JSON.parse(created.stdout);
  assert.ok(
    isRecord(value) &&
      isRecord(value.candidate) &&
      typeof value.candidate.candidateId === "string",
  );
  const candidateId = value.candidate.candidateId;
  const bundle = join(f.root, "inputs/bundle.json");
  await writeFile(bundle, publicationFixture().bundleBytes);
  const publish = (requestId: string) =>
    f.command([
      join(f.host, "publication.mjs"),
      "publish-generation",
      "--request",
      requestId,
      "--candidate",
      candidateId,
      "--bundle",
      bundle,
      "--expect-absent",
    ]);
  const published = publish("publish-one");
  assert.equal(published.status, 0, published.stdout + published.stderr);
  const installed = await f.run("install-native-source-policy", input);
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  assert.ok(isRecord(installed.value.generation));
  const rows = await f.records();
  const bridges = rows.flatMap((row) =>
    row.kind === "native-host-deployment-intent"
      ? [`n${digest(row)}`]
      : row.kind === "native-source-policy-install-intent"
        ? [`n${row.scope.intentDigest}`]
        : [],
  );
  const owners = [
    ["register-one", "register"],
    ["create-one", "create"],
    ["publish-one", "publish"],
    [input.requestId, "install"],
  ];
  const before = await readFile(f.ledger);
  for (const [requestId, owner] of [
    ...owners,
    ...bridges.map((requestId) => [requestId, "bridge"]),
    ["bootstrap", "bridge"],
  ]) {
    assert.ok(requestId && owner);
    for (const family of ["register", "create", "publish", "install"]) {
      if (family === owner) continue;
      let result: unknown;
      if (family === "register")
        result = (
          await f.run("register", {
            ...f.registrationInput,
            requestId,
            expectedPriorRegistration: input.deploymentRegistrationDigest,
          })
        ).value;
      else if (family === "install")
        result = (
          await f.run("install-native-source-policy", {
            ...input,
            requestId,
            expectedPriorGeneration: installed.value.generation.sha256,
          })
        ).value;
      else {
        const command =
          family === "publish"
            ? publish(requestId)
            : f.command([
                join(f.host, "publication.mjs"),
                "create-generated-candidate",
                "--request",
                requestId,
                "--identity",
                f.identityPath,
              ]);
        result = JSON.parse(command.stdout);
      }
      assert.ok(isRecord(result));
      assert.equal(
        result.code,
        "request-conflict",
        JSON.stringify({ requestId, owner, family, result }),
      );
      assert.deepEqual(await readFile(f.ledger), before);
    }
  }
  assert.equal(
    (await f.run("retry-native-source-policy", input.requestId)).status,
    0,
  );
  assert.deepEqual(await readFile(f.ledger), before);
});

it("rejects an oversized determinable registration before namespace bootstrap and accepts a corrected request", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("registration-size");
  context.diagnostic(`Retained registration-size fixture ${f.root}`);
  let parent = join(f.root, "deep");
  await mkdir(parent, { mode: 0o700 });
  for (let index = 0; index < 160; index++) {
    parent = join(parent, `p${String(index).padStart(3, "0")}`);
    await mkdir(parent, { mode: 0o700 });
  }
  const repositories = [];
  for (let index = 0; index < 50; index++) {
    const path = join(parent, `repository-${index}`);
    await mkdir(path, { mode: 0o700 });
    repositories.push(raw(path));
  }
  const refused = await f.run("register", {
    ...f.registrationInput,
    repositories: [...f.registrationInput.repositories, ...repositories],
  });
  assert.equal(
    refused.value.code,
    "invalid-controls",
    JSON.stringify(refused.value),
  );
  assert.match(
    JSON.stringify(refused.value),
    /1 MiB before installation effects/u,
  );
  await assert.rejects(stat(f.ledger), { code: "ENOENT" });
  await assert.rejects(
    stat(join(f.anchor, "academic-os-control-publication")),
    { code: "ENOENT" },
  );
  assert.equal((await f.run("register", f.registrationInput)).status, 0);
});

it("converges new unchanged registration and policy requests using physically owned generations", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("same-generation");
  context.diagnostic(`Retained same-generation fixture ${f.root}`);
  const input = await f.request();
  const registered = await f.run("register", {
    ...f.registrationInput,
    requestId: "register-two",
    expectedPriorRegistration: input.deploymentRegistrationDigest,
  });
  assert.equal(registered.status, 0, JSON.stringify(registered.value));
  const installed = await f.run("install-native-source-policy", input);
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  assert.ok(isRecord(installed.value.generation));
  const updated = await f.run(
    "install-native-source-policy",
    {
      ...input,
      requestId: "install-two",
      expectedPriorGeneration: installed.value.generation.sha256,
    },
    f.extracted,
  );
  assert.equal(updated.status, 0, JSON.stringify(updated.value));
  assert.deepEqual(updated.value.generation, installed.value.generation);
  const retried = await f.run("retry-native-source-policy", "install-two");
  assert.equal(retried.status, 0, JSON.stringify(retried.value));
  assert.deepEqual(retried.value, updated.value);
});
