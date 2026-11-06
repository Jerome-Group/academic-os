import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { isRecord } from "../../src/conformance/value-shape.js";
import {
  encodePublication,
  sha256,
} from "../../src/controls-publication/codec.js";
import { fixture, raw, repository } from "./native-policy-fixture.js";
import { bindFixtureRuntime } from "./runtime-fixture.js";

it("drives registration, install, update and retry from the actual produced and extracted package through a declared compile-time account adapter", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("produced-package");
  context.diagnostic(`Retained produced package policy fixture ${f.root}`);
  const produced = join(f.root, "produced"),
    extracted = join(f.root, "produced-extracted"),
    archive = join(f.root, "produced.tar.gz");
  const packaged = f.command([
    "scripts/build-control-publication-standalone.mjs",
    produced,
  ]);
  assert.equal(packaged.status, 0, packaged.stdout + packaged.stderr);
  const tar = spawnSync("tar", ["-czf", archive, "-C", produced, "."], {
    encoding: "utf8",
  });
  assert.equal(tar.status, 0, tar.stderr);
  await mkdir(extracted, { mode: 0o700 });
  const untar = spawnSync("tar", ["-xzf", archive, "-C", extracted], {
    encoding: "utf8",
  });
  assert.equal(untar.status, 0, untar.stderr);
  const scannerBindings = [];
  const integrity: unknown = JSON.parse(
    await readFile(join(extracted, "runtime-integrity.json"), "utf8"),
  );
  assert.ok(isRecord(integrity));
  assert.ok(Array.isArray(integrity.artifacts));
  for (const source of [
    "scan.native",
    "scan.c",
    "scan-core.c",
    "scan-core.h",
  ]) {
    const target = `native/inventory-${source}`;
    const bytes = await readFile(join(extracted, target));
    assert.deepEqual(
      bytes,
      await readFile(
        join("dist/src/migration/native-inventory/native", source),
      ),
    );
    assert.deepEqual(
      integrity.artifacts.find(
        (artifact: unknown) => isRecord(artifact) && artifact.path === target,
      ),
      {
        path: target,
        role: source === "scan.native" ? "scanner" : "scanner-source",
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      },
    );
    scannerBindings.push({ path: target, sha256: sha256(bytes) });
  }
  const originalLoader = await readFile(join(extracted, "native/index.js"));
  const originalPublication = await readFile(
      join(extracted, "publication.mjs"),
    ),
    originalDeployment = await readFile(join(extracted, "host-deployment.mjs"));
  const manifest: unknown = JSON.parse(
    await readFile(join(extracted, "release.json"), "utf8"),
  );
  assert.ok(isRecord(manifest));
  await copyFile(
    join(f.host, "native/publication-native.node"),
    join(extracted, "native/publication-native.node"),
  );
  const adaptedManifest = {
    ...manifest,
    nativeDigest: sha256(
      await readFile(join(extracted, "native/publication-native.node")),
    ),
  };
  await writeFile(
    join(extracted, "release.json"),
    encodePublication(adaptedManifest),
  );
  await bindFixtureRuntime(extracted, extracted);
  const registration = {
    ...f.registrationInput,
    repositories: [...f.registrationInput.repositories, raw(extracted)],
  };
  const refused = await f.run("register", registration, extracted);
  assert.equal(
    refused.value.code,
    "unsupported-host",
    JSON.stringify(refused.value),
  );
  await assert.rejects(stat(f.ledger), { code: "ENOENT" });
  await writeFile(
    join(extracted, "native/index.js"),
    `import {createRequire} from 'node:module';import {isPublicationNative} from ${JSON.stringify(join(repository, "dist/src/controls-publication/native/index.js"))};export function loadPublicationNative(){const value=createRequire(import.meta.url)('./publication-native.node');if(!isPublicationNative(value)||value.buildKind!=='fixture')throw Error('Declared compile-time fixture account adapter required');return {kind:'ok',value};}`,
  );
  await bindFixtureRuntime(extracted, extracted);
  const scannerRefusals = [];
  for (const name of ["inventory-scan-core.c", "inventory-scan-core.h"]) {
    const path = join(extracted, "native", name);
    const bytes = await readFile(path);
    await writeFile(path, Buffer.concat([bytes, Buffer.from("\n")]));
    const changed = await f.run("register", registration, extracted);
    assert.notEqual(changed.status, 0, JSON.stringify(changed.value));
    await assert.rejects(stat(f.ledger), { code: "ENOENT" });
    await writeFile(path, bytes);
    const retained = join(f.root, `missing-produced-${name}`);
    await rename(path, retained);
    const missing = await f.run("register", registration, extracted);
    assert.notEqual(missing.status, 0, JSON.stringify(missing.value));
    await assert.rejects(stat(f.ledger), { code: "ENOENT" });
    await rename(retained, path);
    scannerRefusals.push({
      name,
      changed: changed.value,
      missing: missing.value,
    });
  }
  const registered = await f.run("register", registration, extracted);
  assert.equal(registered.status, 0, JSON.stringify(registered.value));
  const request = {
    requestId: "packaged-install",
    deploymentRegistrationDigest: registered.value.registrationDigest,
    expectedPriorGeneration: null,
    slots: [
      {
        sourceKey: "packaged-one",
        enclosureLocatorBase64: raw(f.enclosure),
        snapshotLocatorBase64: raw(f.source),
      },
    ],
  };
  const installed = await f.run(
    "install-native-source-policy",
    request,
    extracted,
  );
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  const retried = await f.run(
    "retry-native-source-policy",
    request.requestId,
    extracted,
  );
  assert.equal(retried.status, 0, JSON.stringify(retried.value));
  assert.deepEqual(retried.value, installed.value);
  assert.ok(isRecord(installed.value.generation));
  const update = await f.run(
    "install-native-source-policy",
    {
      ...request,
      requestId: "packaged-update",
      expectedPriorGeneration: installed.value.generation.sha256,
      slots: [{ ...request.slots[0], sourceKey: "packaged-two" }],
    },
    extracted,
  );
  assert.equal(update.status, 0, JSON.stringify(update.value));
  const historical = await f.run(
    "retry-native-source-policy",
    request.requestId,
    extracted,
  );
  assert.equal(historical.status, 0, JSON.stringify(historical.value));
  assert.deepEqual(historical.value, installed.value);
  assert.deepEqual(
    await readFile(join(extracted, "publication.mjs")),
    originalPublication,
  );
  assert.deepEqual(
    await readFile(join(extracted, "host-deployment.mjs")),
    originalDeployment,
  );
  await writeFile(
    join(f.root, "package-adaptation.json"),
    JSON.stringify(
      {
        archiveSha256: sha256(await readFile(archive)),
        productionSourceDigest: manifest.sourceDigest,
        originalNativeDigest: manifest.nativeDigest,
        fixtureNativeDigest: adaptedManifest.nativeDigest,
        originalLoaderSha256: sha256(originalLoader),
        adaptedLoaderSha256: sha256(
          await readFile(join(extracted, "native/index.js")),
        ),
        publicationBytesUnchanged: true,
        hostDeploymentBytesUnchanged: true,
        scannerBindings,
        scannerRefusals,
        productionLoaderRefusedFixture: refused.value,
        registration: registered.value,
        installation: installed.value,
        retry: retried.value,
        update: update.value,
        historicalRetry: historical.value,
      },
      null,
      2,
    ),
  );
});
