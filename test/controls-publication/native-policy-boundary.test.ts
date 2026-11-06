import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
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
import { fixture, raw } from "./native-policy-fixture.js";
import { bindFixtureRuntime } from "./runtime-fixture.js";

it("refuses changed installed transitive dependency and non-JavaScript inputs before account entry and restores exact policy retry", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("dependency-boundary");
  context.diagnostic(`Retained dependency boundary fixture ${f.root}`);
  const nested = join(f.host, "node_modules/ajv/node_modules/fast-uri");
  await mkdir(join(f.host, "node_modules/ajv/node_modules"), {
    recursive: true,
    mode: 0o700,
  });
  await cp(join(f.host, "node_modules/fast-uri"), nested, { recursive: true });
  const marker = join(f.root, "nested-dependency-executed.json");
  const nestedEntry = join(nested, "index.js");
  await writeFile(
    nestedEntry,
    Buffer.concat([
      await readFile(nestedEntry),
      Buffer.from(
        `\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, JSON.stringify({dependency:"nested-fast-uri",pid:process.pid}));\n`,
      ),
    ]),
  );
  await bindFixtureRuntime(f.host, join(f.host, "src/controls-publication"));
  const request = await f.request();
  assert.equal(
    JSON.parse(await readFile(marker, "utf8")).dependency,
    "nested-fast-uri",
  );
  const before = await readFile(f.ledger);
  const observations: object[] = [];
  await writeFile(
    f.checkpoint,
    JSON.stringify({ edge: "before-handle-guard", action: "throw" }),
  );
  for (const target of [
    "ajv/dist/ajv.js",
    "ajv/dist/refs/json-schema-draft-07.json",
    "ajv/node_modules/fast-uri/index.js",
    "ajv/node_modules/fast-uri/package.json",
    "yaml/dist/index.js",
  ]) {
    const path = join(f.host, "node_modules", target);
    const original = await readFile(path);
    for (const mutation of ["changed", "missing"]) {
      const retained = join(
        f.root,
        `retained-dependency-${observations.length}`,
      );
      if (mutation === "changed")
        await writeFile(
          path,
          Buffer.concat([
            original,
            Buffer.from(
              target.endsWith(".json")
                ? "\n"
                : "\n// retained installed-dependency mutation\n",
            ),
          ]),
        );
      else await rename(path, retained);
      const result = await f.run("install-native-source-policy", request);
      const ownerEntered = await stat(join(f.root, "fault-hit.json")).then(
        () => true,
        () => false,
      );
      const ledgerUnchanged = (await readFile(f.ledger)).equals(before);
      observations.push({
        target,
        mutation,
        result: result.value,
        ownerEntered,
        ledgerUnchanged,
      });
      await writeFile(
        join(f.root, "dependency-boundary-result.json"),
        JSON.stringify({ observations, commands: f.commands }, null, 2),
      );
      if (mutation === "changed") await writeFile(path, original);
      else await rename(retained, path);
      assert.notEqual(result.status, 0, `${target} ${mutation} was accepted`);
      assert.equal(
        ownerEntered,
        false,
        "changed dependency reached the account owner",
      );
      assert.equal(ledgerUnchanged, true);
    }
  }
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
  const registration = settled.record.registration;
  const source = rows.find(
    (row) =>
      row.record.kind === "file-claimed" &&
      sha256(encodePublication(row.record)) ===
        registration.claim.generatedClaimRecordDigest,
  );
  assert.ok(source?.record.kind === "file-claimed");
  const observations: object[] = [];
  for (const forgedName of [
    Buffer.from("not-the-claimed-registration.json").toString("base64"),
    source.record.file.location.rawNameBase64,
  ]) {
    settled.record.registration.claim.location.rawNameBase64 = forgedName;
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
    await writeFile(
      join(f.root, "ledger-before-location-change.jsonl"),
      before,
    );
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
    observations.push({
      forgedName,
      retry: retry.value,
      generated: generated.stdout,
      retryLedgerUnchanged: afterRetry.equals(corrupted),
      generatedLedgerUnchanged: afterGenerated.equals(corrupted),
    });
    await writeFile(
      join(f.root, "claim-location-boundary-result.json"),
      JSON.stringify({ observations, commands: f.commands }, null, 2),
    );
    assert.notEqual(retry.status, 0, "false filename accepted by exact retry");
    assert.notEqual(
      generated.status,
      0,
      "false filename accepted by unrelated mutation",
    );
    assert.deepEqual(afterRetry, corrupted);
    assert.deepEqual(afterGenerated, corrupted);
  }
  const legacy = rows.filter(
    (row) =>
      row.record.kind !== "native-selector-move-intent" &&
      row.record.kind !== "native-selector-move-observed",
  );
  settled.record.registration.claim.location.rawNameBase64 = Buffer.from(
    "host-deployment.json",
  ).toString("base64");
  let previous: string | null = null;
  const incomplete = Buffer.concat(
    legacy.map((row, sequence) => {
      const bytes = encodePublication({
        ...row,
        sequence,
        previousEventByteSha256: previous,
      });
      previous = sha256(bytes);
      return Buffer.concat([bytes, Buffer.from("\n")]);
    }),
  );
  await writeFile(f.ledger, incomplete);
  const legacyRetry = await f.run("register", f.registrationInput);
  assert.notEqual(
    legacyRetry.status,
    0,
    "experimental selector without move evidence was adopted",
  );
  assert.deepEqual(await readFile(f.ledger), incomplete);
  await writeFile(
    join(f.root, "experimental-history-refusal.json"),
    JSON.stringify(
      { result: legacyRetry.value, ledgerUnchanged: true },
      null,
      2,
    ),
  );
});

for (const operation of ["registration", "policy"] as const)
  for (const edge of [
    "after-policy-selector-swap",
    "after-policy-selector-archive",
  ])
    it(`preserves completed ${operation} and generated readback during ${edge} and recovers the exact pending move`, {
      skip: process.platform !== "darwin",
      timeout: 180000,
    }, async (context) => {
      const f = await fixture(`selector-${operation}-${edge}`);
      context.diagnostic(`Retained selector recovery fixture ${f.root}`);
      const input = await f.request();
      const registered = await f.run("register", f.registrationInput);
      const installed =
        operation === "policy"
          ? await f.run("install-native-source-policy", input)
          : null;
      if (installed)
        assert.equal(installed.status, 0, JSON.stringify(installed.value));
      const generatedArgs = [
        join(f.host, "publication.mjs"),
        "create-generated-candidate",
        "--request",
        "completed-before-native-update",
        "--identity",
        f.identityPath,
      ];
      const generated = f.command(generatedArgs);
      assert.equal(generated.status, 0, generated.stdout + generated.stderr);
      await mkdir(join(f.root, "another-repository"), { mode: 0o700 });
      const update =
        operation === "policy"
          ? {
              ...input,
              requestId: "update-policy",
              expectedPriorGeneration:
                installed?.value.generation &&
                typeof installed.value.generation === "object" &&
                "sha256" in installed.value.generation
                  ? installed.value.generation.sha256
                  : null,
              slots: [{ ...input.slots[0], sourceKey: "private-updated" }],
            }
          : {
              ...f.registrationInput,
              requestId: "register-two",
              expectedPriorRegistration: registered.value.registrationDigest,
              repositories: [
                ...f.registrationInput.repositories,
                raw(join(f.root, "another-repository")),
              ],
            };
      const action =
        operation === "policy" ? "install-native-source-policy" : "register";
      await writeFile(f.checkpoint, JSON.stringify({ edge, action: "kill" }));
      const interrupted = await f.run(action, update);
      assert.equal(interrupted.signal, "SIGKILL");
      assert.equal(
        JSON.parse(await readFile(join(f.root, "fault-hit.json"), "utf8")).edge,
        edge,
      );
      await unlink(f.checkpoint);
      const pending = await readFile(f.ledger);
      const prior =
        operation === "policy"
          ? await f.run("retry-native-source-policy", input.requestId)
          : await f.run("register", f.registrationInput);
      assert.equal(prior.status, 0, JSON.stringify(prior.value));
      assert.deepEqual(
        prior.value,
        operation === "policy" ? installed?.value : registered.value,
      );
      assert.deepEqual(await readFile(f.ledger), pending);
      const completed = f.command(generatedArgs);
      assert.equal(completed.status, 0, completed.stdout + completed.stderr);
      assert.deepEqual(
        JSON.parse(completed.stdout),
        JSON.parse(generated.stdout),
      );
      assert.deepEqual(await readFile(f.ledger), pending);
      const blocked = f.command([
        ...generatedArgs.slice(0, 3),
        "unrelated-while-native-pending",
        ...generatedArgs.slice(4),
      ]);
      assert.notEqual(blocked.status, 0);
      assert.deepEqual(await readFile(f.ledger), pending);
      const restored = await f.run(action, update);
      assert.equal(restored.status, 0, JSON.stringify(restored.value));
      const retry = await f.run(action, update);
      assert.deepEqual(retry.value, restored.value);
      const rows = await f.records();
      const intent = rows.find(
        (row) =>
          row.kind === "native-selector-move-intent" &&
          row.scope.requestId === update.requestId,
      );
      assert.ok(intent?.kind === "native-selector-move-intent");
      assert.equal(
        rows.filter(
          (row) =>
            row.kind === "native-selector-move-observed" &&
            row.moveIntentDigest === sha256(encodePublication(intent)),
        ).length,
        1,
      );
      await writeFile(
        join(f.root, "selector-recovery-result.json"),
        JSON.stringify(
          {
            operation,
            edge,
            interrupted: interrupted.value,
            prior: prior.value,
            completed: JSON.parse(completed.stdout),
            blocked: JSON.parse(blocked.stdout),
            restored: restored.value,
            retry: retry.value,
            commands: f.commands,
          },
          null,
          2,
        ),
      );
    });
