import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";
import { decoded, hash, makeFixture } from "./fixture.mjs";

const raw = (path) => Buffer.from(path).toString("base64");
const success = (call) => {
  assert.equal(call.status, 0, call.stdout + call.stderr);
  return decoded(call);
};
const refused = (call, code) => {
  const value = decoded(call);
  assert.notEqual(call.status, 0, JSON.stringify(value));
  if (code) assert.equal(value.code, code, JSON.stringify(value));
  return value;
};
async function nativeFixture(root, evidence, name, mutate) {
  const f = await makeFixture(root, evidence, name, mutate);
  const enclosure = join(f.evidence, "private"),
    snapshot = join(enclosure, "snapshot");
  for (const path of [
    enclosure,
    snapshot,
    join(f.evidence, "live"),
    join(f.evidence, "state"),
  ])
    await mkdir(path, { mode: 0o700 });
  const configuration = join(f.evidence, "configuration.json");
  await writeFile(
    configuration,
    JSON.stringify({
      schemaVersion: 1,
      driveMount: join(f.evidence, "live"),
      stateRoot: join(f.evidence, "state"),
    }),
    { mode: 0o600 },
  );
  const registration = {
    requestId: "native-register",
    configurations: [raw(configuration)],
    repositories: [
      raw(root),
      raw(f.host),
      raw(f.source),
      raw(join(f.host, "src/controls-publication")),
    ],
    expectedPriorRegistration: null,
  };
  let serial = 0;
  const run = async (action, input, bundled = false) => {
    const inputPath = join(f.evidence, `native-input-${++serial}.json`);
    await writeFile(inputPath, JSON.stringify(input), { mode: 0o600 });
    return f.command(process.execPath, [
      bundled
        ? join(f.host, "host-deployment.mjs")
        : join(f.host, "src/controls-publication/host-deployment.js"),
      action,
      action === "retry-native-source-policy" ? "--request" : "--input",
      action === "retry-native-source-policy" ? input : inputPath,
    ]);
  };
  const prepare = async () => {
    const registered = success(await run("register", registration));
    return {
      requestId: "native-install",
      deploymentRegistrationDigest: registered.registrationDigest,
      expectedPriorGeneration: null,
      slots: [
        {
          sourceKey: "private-one",
          enclosureLocatorBase64: raw(enclosure),
          snapshotLocatorBase64: raw(snapshot),
        },
      ],
    };
  };
  return { ...f, enclosure, snapshot, registration, run, prepare };
}
const cases = [
  {
    name: "native-request-namespace",
    property: "P2",
    mutate: (replace) =>
      replace(
        "src/controls-publication/native-policy-history.ts",
        'case "native-host-deployment-intent":\n      return { requestId: record.request.requestId, kind: record.kind };',
        'case "native-host-deployment-intent":\n      return undefined;',
      ),
  },
  { name: "native-full-suffix", property: "P9" },
  {
    name: "native-completed-before-pending",
    property: "P4",
    mutate: (replace) =>
      replace(
        "src/controls-publication/owner.ts",
        "const value = input.completed?.(loaded, releaseDigest);",
        "if (input.mutate) requirePendingOrder(loaded, input);\n                const value = input.completed?.(loaded, releaseDigest);",
      ),
  },
  {
    name: "native-physical-location",
    property: "P3/P5",
    mutate: (replace) =>
      replace(
        "src/controls-publication/native-blob-history.ts",
        "    !recorded ||\n    !reached ||\n    (options.current &&\n      (!current ||\n        !recordedParent ||\n        !sameLocation(current, {\n          parent: recordedParent,\n          rawNameBase64: blob.claim.location.rawNameBase64,\n        })))",
        "    false",
      ),
  },
  {
    name: "native-move-intent-order",
    property: "P7/P8",
    mutate: async (replace) => {
      const file = "src/controls-publication/native-policy-persistence.ts";
      const text = await readFile(join(activeRoot, file), "utf8");
      const start = text.indexOf(
        "  const move = appendOnce(store, {",
        text.indexOf("export function replaceSelector("),
      );
      const end = text.indexOf("  let expectedHead:", start);
      const move = text.slice(start, end);
      assert.ok(start > 0 && end > start);
      await replace(file, move, "");
      await replace(
        file,
        "  store.syncDirectory(store.namespace);\n  if (prior) {",
        `${move}  store.syncDirectory(store.namespace);\n  if (prior) {`,
      );
    },
  },
  {
    name: "native-frozen-expected-old",
    property: "P6",
    mutate: (replace) =>
      replace(
        "src/controls-publication/native-source-policy.ts",
        "(selected?.generation.sha256 ?? null) !==\n          request.expectedPriorGeneration",
        "false",
      ),
  },
  {
    name: "native-early-receipt",
    property: "P8",
    mutate: (replace) =>
      replace(
        "src/controls-publication/native-source-policy.ts",
        "        const bytes = encodePublication(receipt);",
        "        return receipt;\n        const bytes = encodePublication(receipt);",
      ),
  },
  {
    name: "native-runtime-digest",
    property: "P10",
    mutate: (replace) =>
      replace(
        "src/controls-publication/runtime-consistency.ts",
        "sha256(bytes) !== artifact.sha256",
        "false",
      ),
  },
];
let activeRoot;
async function rechain(f, rows) {
  const { encodePublication } = await import(
    pathToFileURL(join(activeRoot, "dist/src/controls-publication/codec.js"))
      .href
  );
  let previous = null;
  const bytes = Buffer.concat(
    rows.map((row, sequence) => {
      const value = encodePublication({
        ...row,
        sequence,
        previousEventByteSha256: previous,
      });
      previous = hash(value);
      return Buffer.concat([value, Buffer.from("\n")]);
    }),
  );
  await writeFile(f.ledger, bytes);
  return bytes;
}
async function scenario(f, name) {
  if (name === "native-request-namespace") {
    success(await f.run("register", f.registration));
    const before = await readFile(f.ledger),
      call = f.create(f.registration.requestId),
      value = decoded(call);
    const rows = await f.events();
    const duplicate = rows.filter(
      (row) =>
        row.record.kind === "candidate-reserved" &&
        row.record.binding.requestId === f.registration.requestId,
    );
    const subsequent = await f.run("register", f.registration);
    return {
      violated:
        duplicate.length === 1 && !(await readFile(f.ledger)).equals(before),
      controlPassed:
        call.status !== 0 &&
        value.code === "request-conflict" &&
        (await readFile(f.ledger)).equals(before) &&
        subsequent.status === 0,
      call,
      subsequent,
      duplicate,
      ledgerBeforeSha256: hash(before),
      ledgerAfterSha256: hash(await readFile(f.ledger)),
    };
  }
  if (name === "native-completed-before-pending") {
    const input = await f.prepare(),
      completed = success(f.create("completed-generated"));
    const installed = success(
      await f.run("install-native-source-policy", input),
    );
    const update = {
      ...input,
      requestId: "pending-native",
      expectedPriorGeneration: installed.generation.sha256,
      slots: [{ ...input.slots[0], sourceKey: "private-two" }],
    };
    await f.fault({
      key: "replaceSelectorGuarded|after-policy-selector-swap|promotion-intent",
      mode: "kill",
    });
    const interrupted = await f.run("install-native-source-policy", update);
    assert.equal(
      interrupted.signal,
      "SIGKILL",
      interrupted.stdout + interrupted.stderr,
    );
    const pending = await readFile(f.ledger);
    await f.fault({ key: "syncFile|before-file-sync|none", mode: "throw" });
    const retried = f.create("completed-generated"),
      value = decoded(retried);
    assert.deepEqual(await readFile(f.ledger), pending);
    await f.clear();
    const fresh = f.create("must-wait-for-pending");
    assert.notEqual(fresh.status, 0);
    assert.deepEqual(await readFile(f.ledger), pending);
    return {
      violated: retried.status !== 0 && value.kind === "recovery-required",
      controlPassed:
        retried.status === 0 &&
        JSON.stringify(value) === JSON.stringify(completed),
      interrupted,
      retried,
      fresh,
      pendingSha256: hash(pending),
    };
  }
  if (name === "native-physical-location") {
    success(await f.run("register", f.registration));
    const original = await readFile(f.ledger),
      rows = await f.events();
    const row = rows.findLast(
      (row) => row.record.kind === "native-host-deployment-settled",
    );
    row.record.registration.claim.location.rawNameBase64 = raw(
      "nonexistent-same-parent.json",
    );
    const corrupted = await rechain(f, rows);
    await writeFile(join(f.evidence, "ledger-original.jsonl"), original);
    await writeFile(join(f.evidence, "ledger-corrupted.jsonl"), corrupted);
    const retried = await f.run("register", f.registration),
      afterRetry = await readFile(f.ledger),
      fresh = f.create("after-invalid-native-location"),
      afterFresh = await readFile(f.ledger);
    return {
      violated:
        retried.status === 0 ||
        fresh.status === 0 ||
        !afterFresh.equals(corrupted),
      controlPassed:
        retried.status !== 0 &&
        fresh.status !== 0 &&
        afterRetry.equals(corrupted) &&
        afterFresh.equals(corrupted),
      retried,
      fresh,
      ledgerUnchanged: afterFresh.equals(corrupted),
    };
  }
  if (name === "native-move-intent-order") {
    const input = await f.prepare(),
      installed = success(await f.run("install-native-source-policy", input));
    const update = {
      ...input,
      requestId: "native-swap-order",
      expectedPriorGeneration: installed.generation.sha256,
      slots: [{ ...input.slots[0], sourceKey: "private-two" }],
    };
    await f.fault({
      key: "replaceSelectorGuarded|after-policy-selector-swap|promotion-intent",
      mode: "kill",
      trace: true,
    });
    const interrupted = await f.run("install-native-source-policy", update);
    assert.equal(
      interrupted.signal,
      "SIGKILL",
      interrupted.stdout + interrupted.stderr,
    );
    const rows = await f.events(),
      move = rows.find(
        (row) =>
          row.record.kind === "native-selector-move-intent" &&
          row.record.scope.requestId === update.requestId,
      );
    const head = join(
        f.anchor,
        "academic-os-control-publication/native-source-policy.json",
      ),
      bytes = await readFile(head),
      physical = await lstat(head);
    const intent = rows.find(
      (row) =>
        row.record.kind === "native-source-policy-selector-intent" &&
        row.record.scope.requestId === update.requestId,
    );
    assert.ok(intent);
    assert.ok(bytes.includes(Buffer.from(intent.record.generation.sha256)));
    const pending = await readFile(f.ledger);
    await f.clear();
    let prior, recovered;
    if (move) {
      prior = await f.run("retry-native-source-policy", input.requestId);
      success(prior);
      assert.deepEqual(await readFile(f.ledger), pending);
      recovered = await f.run("install-native-source-policy", update);
      success(recovered);
    }
    return {
      violated: !move,
      controlPassed:
        Boolean(move) && prior.status === 0 && recovered.status === 0,
      interrupted,
      moveIntent: move,
      physicalHead: {
        path: head,
        inode: physical.ino,
        byteLength: bytes.length,
        sha256: hash(bytes),
      },
      prior,
      recovered,
      trace: f.trace,
    };
  }
  if (name === "native-frozen-expected-old") {
    const input = await f.prepare(),
      first = success(await f.run("install-native-source-policy", input));
    const before = await readFile(f.ledger);
    const call = await f.run("install-native-source-policy", {
      ...input,
      requestId: "wrong-expected-old",
      expectedPriorGeneration: "f".repeat(64),
      slots: [{ ...input.slots[0], sourceKey: "private-two" }],
    });
    const after = await readFile(f.ledger),
      rows = await f.events();
    const starter = rows.find(
      (row) =>
        row.record.kind === "native-source-policy-install-intent" &&
        row.record.scope.requestId === "wrong-expected-old",
    );
    return {
      violated: Boolean(starter) && !after.equals(before),
      controlPassed:
        call.status !== 0 &&
        decoded(call).code === "stale-head" &&
        after.equals(before),
      call,
      starter,
      originalGeneration: first.generation.sha256,
      ledgerBeforeSha256: hash(before),
      ledgerAfterSha256: hash(after),
    };
  }
  if (name === "native-early-receipt") return packagedReceipt(f);
  if (name === "native-runtime-digest") {
    const input = await f.prepare(),
      before = await readFile(f.ledger),
      path = join(
        f.host,
        "node_modules/ajv/dist/refs/json-schema-draft-07.json",
      ),
      original = await readFile(path);
    const changed = Buffer.from(
      original
        .toString()
        .replace("Core schema meta-schema", "Core schema meta-schemX"),
    );
    assert.equal(changed.length, original.length);
    assert.notDeepEqual(changed, original);
    JSON.parse(changed);
    const integrity = await readFile(
      join(f.host, "src/controls-publication/runtime-integrity.json"),
    );
    await writeFile(path, changed);
    await f.fault({
      key: "resolveAccountAnchor|before-call|none",
      mode: "throw",
    });
    const call = await f.run("install-native-source-policy", input);
    const hit = await readFile(f.hit, "utf8").then(JSON.parse, () => null);
    assert.deepEqual(await readFile(f.ledger), before);
    assert.deepEqual(
      await readFile(
        join(f.host, "src/controls-publication/runtime-integrity.json"),
      ),
      integrity,
    );
    await writeFile(join(f.evidence, "changed-dependency.json"), changed);
    await writeFile(path, original);
    await f.clear();
    const restored = await f.run("install-native-source-policy", input);
    success(restored);
    return {
      violated: hit?.key === "resolveAccountAnchor|before-call|none",
      controlPassed: !hit && call.status !== 0 && restored.status === 0,
      call,
      hit,
      restored,
      dependency: {
        path,
        originalSha256: hash(original),
        changedSha256: hash(changed),
        byteLength: original.length,
      },
      integritySha256: hash(integrity),
    };
  }
  throw Error(`Missing native scenario ${name}`);
}
async function fullSuffix(f) {
  const input = await f.prepare();
  const installed = success(await f.run("install-native-source-policy", input));
  const completed = success(f.create("capacity-completed"));
  const planner = await plannerAudit(f);
  const sourcePath = join(
    activeRoot,
    "test/controls-publication/replay-capacity.test.ts",
  );
  const source = await readFile(sourcePath, "utf8"),
    prefix = source.slice(0, source.indexOf('it("shares immutable'));
  assert.ok(prefix.length > 1000);
  const helper = join(f.evidence, "production-padding.mjs");
  await build({
    stdin: {
      contents: `${prefix}\nexport {pad};`,
      resolveDir: join(activeRoot, "test/controls-publication"),
      loader: "ts",
    },
    outfile: helper,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
  const { pad } = await import(pathToFileURL(helper).href);
  const padding = await pad(f, "unique");
  const before = await readFile(f.ledger),
    candidateParent = join(
      f.anchor,
      "academic-os-control-publication/candidates",
    ),
    names = await readdir(candidateParent);
  const fixed = f.create("capacity-must-refuse");
  refused(fixed);
  assert.match(fixed.stdout, /complete recovery suffix.*256 MiB/);
  assert.deepEqual(await readFile(f.ledger), before);
  const file = "src/controls-publication/store.ts",
    originalSource = await readFile(join(f.source, file)),
    compiledPath = join(f.host, file.replace(/\.ts$/, ".js")),
    originalCompiled = await readFile(compiledPath);
  await f.replace(
    file,
    "    this.allocation().require(\n      suffix.allocation - this.preparedAllocation,\n      suffix.rows,\n    );",
    "    void suffix;",
  );
  await writeFile(
    compiledPath,
    (
      await transform(await readFile(join(f.source, file), "utf8"), {
        loader: "ts",
        format: "esm",
        target: "node24",
      })
    ).code,
  );
  await f.bindRuntime();
  const mutant = f.create("capacity-mutant-create"),
    after = await readFile(f.ledger),
    rows = await f.events();
  const starter = rows.find(
    (row) =>
      row.record.kind === "candidate-reserved" &&
      row.record.binding.requestId === "capacity-mutant-create",
  );
  assert.ok(starter, "Full-suffix guard removal must append a real starter");
  assert.ok(after.length > before.length, "Mutant must change durable history");
  await writeFile(join(f.evidence, "capacity-mutant-ledger.jsonl"), after);
  const retained = (await readdir(candidateParent)).filter(
    (name) => !names.includes(name),
  );
  const restoredBaseline = await readFile(f.ledger),
    restoredNames = await readdir(candidateParent);
  assert.deepEqual(restoredBaseline.subarray(0, before.length), before);
  await writeFile(join(f.source, file), originalSource);
  await writeFile(compiledPath, originalCompiled);
  assert.equal(
    hash(await readFile(join(f.source, file))),
    hash(originalSource),
  );
  assert.equal(hash(await readFile(compiledPath)), hash(originalCompiled));
  await f.bindRuntime();
  const restored = f.create("capacity-restored-create");
  refused(restored);
  assert.match(restored.stdout, /complete recovery suffix.*256 MiB/);
  assert.deepEqual(await readFile(f.ledger), restoredBaseline);
  assert.deepEqual(await readdir(candidateParent), restoredNames);
  const completedRetry = success(f.create("capacity-completed"));
  assert.deepEqual(completedRetry, completed);
  const historical = success(
    await f.run("retry-native-source-policy", input.requestId),
  );
  assert.deepEqual(historical, installed);
  assert.deepEqual(await readFile(f.ledger), restoredBaseline);
  return {
    violated: true,
    controlPassed: true,
    planner,
    padding,
    fixed,
    mutant,
    starter,
    restored,
    completedRetry,
    historical,
    retained,
    sourceHash: hash(source),
    restoredSourceSha256: hash(originalSource),
    restoredCompiledSha256: hash(originalCompiled),
    beforeSha256: hash(before),
    afterSha256: hash(after),
  };
}

export async function nativeMutations(root, evidence, only) {
  activeRoot = root;
  const results = [];
  for (const test of cases.filter((test) => !only || test.name === only)) {
    const f = await nativeFixture(
      root,
      evidence,
      `mutant-${test.name}`,
      test.mutate,
    );
    let finding;
    try {
      finding =
        test.name === "native-full-suffix"
          ? await fullSuffix(f)
          : await scenario(f, test.name);
      assert.equal(
        finding.violated,
        true,
        `Actual native behavioral counterexample required ${test.name}`,
      );
    } finally {
      await f.clear();
      await f.save({ name: test.name, property: test.property, finding });
    }
    for (const patch of f.patches.filter(
      (patch, index, all) =>
        all.findIndex((value) => value.file === patch.file) === index,
    )) {
      await copyFile(join(root, patch.file), join(f.source, patch.file));
      assert.equal(
        hash(await readFile(join(f.source, patch.file))),
        patch.originalSha256,
        "Exact native source restored",
      );
    }
    let restoredEvidence, control;
    if (test.name === "native-full-suffix") {
      restoredEvidence = f.evidence;
      control = finding;
    } else {
      const restored = await nativeFixture(
        root,
        evidence,
        `restored-${test.name}`,
      );
      try {
        control = await scenario(restored, test.name);
        assert.equal(
          control.violated,
          false,
          `Restored native behavior ${test.name}`,
        );
        assert.equal(
          control.controlPassed,
          true,
          `Restored native control ${test.name}`,
        );
      } finally {
        await restored.clear();
        await restored.save({ name: test.name, control });
      }
      restoredEvidence = restored.evidence;
    }
    results.push({
      name: test.name,
      property: test.property,
      outcome: "passed",
      mutant: f.evidence,
      restored: restoredEvidence,
      finding,
      control,
    });
    await writeFile(
      join(evidence, "native-mutations-progress.json"),
      JSON.stringify(results, null, 2),
    );
  }
  return results;
}

async function packagedReceipt(f) {
  await cp(join(activeRoot, "dist/src"), join(f.source, "dist/src"), {
    recursive: true,
  });
  await copyFile(
    join(activeRoot, "package-lock.json"),
    join(f.source, "package-lock.json"),
  );
  await unlink(join(f.source, "node_modules"));
  await cp(join(activeRoot, "node_modules"), join(f.source, "node_modules"), {
    recursive: true,
  });
  const file = "src/controls-publication/native-source-policy.ts";
  if (f.patches.some((patch) => patch.file === file))
    await writeFile(
      join(f.source, "dist", file.replace(/\.ts$/, ".js")),
      (
        await transform(await readFile(join(f.source, file), "utf8"), {
          loader: "ts",
          format: "esm",
          target: "node24",
        })
      ).code,
    );
  const released = f.command(process.execPath, [
    join(f.source, "scripts/build-control-publication-release.mjs"),
  ]);
  assert.equal(released.status, 0, released.stdout + released.stderr);
  const produced = join(f.evidence, "produced"),
    extracted = join(f.evidence, "produced-extracted"),
    archive = join(f.evidence, "produced.tar.gz");
  const packaged = f.command(process.execPath, [
    join(f.source, "scripts/build-control-publication-standalone.mjs"),
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
  const originalBundle = await readFile(join(extracted, "host-deployment.mjs")),
    originalPublication = await readFile(join(extracted, "publication.mjs"));
  await copyFile(f.addon, join(extracted, "native/publication-native.node"));
  const manifest = JSON.parse(
    await readFile(join(extracted, "release.json"), "utf8"),
  );
  manifest.nativeDigest = hash(await readFile(f.addon));
  await writeFile(join(extracted, "release.json"), JSON.stringify(manifest));
  const { bindFixtureRuntime } = await import(
    pathToFileURL(
      join(activeRoot, "dist/test/controls-publication/runtime-fixture.js"),
    ).href
  );
  await bindFixtureRuntime(extracted, extracted);
  let serial = 0;
  const run = async (action, input) => {
    const path = join(f.evidence, `packaged-input-${++serial}.json`);
    await writeFile(path, JSON.stringify(input));
    return f.command(process.execPath, [
      join(extracted, "host-deployment.mjs"),
      action,
      action === "retry-native-source-policy" ? "--request" : "--input",
      action === "retry-native-source-policy" ? input : path,
    ]);
  };
  const registration = {
    ...f.registration,
    repositories: [...f.registration.repositories, raw(extracted)],
  };
  const productionRefusal = await run("register", registration);
  refused(productionRefusal, "unsupported-host");
  await assert.rejects(stat(f.ledger), { code: "ENOENT" });
  await writeFile(
    join(extracted, "native/index.js"),
    `import {createRequire} from 'node:module';import {isPublicationNative} from ${JSON.stringify(join(activeRoot, "dist/src/controls-publication/native/index.js"))};export function loadPublicationNative(){const value=createRequire(import.meta.url)('./publication-native.node');if(!isPublicationNative(value)||value.buildKind!=='fixture')throw Error('Declared fixed account adapter required');return {kind:'ok',value};}`,
  );
  await bindFixtureRuntime(extracted, extracted);
  for (const directory of [f.host, join(f.host, "src/controls-publication")])
    await writeFile(join(directory, "release.json"), JSON.stringify(manifest));
  await f.bindRuntime();
  const registered = success(await run("register", registration));
  const input = {
    requestId: "packaged-native-install",
    deploymentRegistrationDigest: registered.registrationDigest,
    expectedPriorGeneration: null,
    slots: [
      {
        sourceKey: "private-package",
        enclosureLocatorBase64: raw(f.enclosure),
        snapshotLocatorBase64: raw(f.snapshot),
      },
    ],
  };
  const call = await run("install-native-source-policy", input),
    value = success(call);
  const hostRetry = await f.run("retry-native-source-policy", input.requestId);
  assert.deepEqual(success(hostRetry), value);
  const rows = await f.events(),
    intent = rows.find(
      (row) =>
        row.record.kind === "native-source-policy-receipt-intent" &&
        row.record.scope.requestId === input.requestId,
    ),
    settled = rows.find(
      (row) =>
        row.record.kind === "native-source-policy-receipt-settled" &&
        row.record.scope.requestId === input.requestId,
    );
  const directory = join(
      f.anchor,
      "academic-os-control-publication/native-policy-receipts",
    ),
    files = await readdir(directory).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  let physical;
  if (settled) {
    const path = join(
        directory,
        Buffer.from(
          settled.record.blob.claim.location.rawNameBase64,
          "base64",
        ).toString(),
      ),
      bytes = await readFile(path);
    assert.equal(hash(bytes), settled.record.blob.sha256);
    assert.deepEqual(JSON.parse(bytes), value);
    physical = {
      path,
      sha256: hash(bytes),
      length: bytes.length,
      inode: (await lstat(path)).ino,
    };
  }
  assert.deepEqual(
    await readFile(join(extracted, "host-deployment.mjs")),
    originalBundle,
  );
  assert.deepEqual(
    await readFile(join(extracted, "publication.mjs")),
    originalPublication,
  );
  const members = {};
  for (const name of [
    "host-deployment.mjs",
    "publication.mjs",
    "native/inventory-scan.native",
    "native/inventory-scan.c",
    "native/package.json",
  ]) {
    const original = await readFile(join(produced, name));
    assert.deepEqual(await readFile(join(extracted, name)), original);
    members[name] = hash(original);
  }
  const readback = await physicalReadback(f);
  return {
    violated: !intent && !settled && files.length === 0,
    controlPassed: Boolean(intent && settled && physical),
    readback,
    call,
    hostRetry,
    intent,
    settled,
    physical,
    files,
    productionRefusal,
    package: {
      produced,
      extracted,
      archive,
      archiveSha256: hash(await readFile(archive)),
      members,
      tar: { pid: tar.pid, status: tar.status },
      untar: { pid: untar.pid, status: untar.status },
      declaredAdaptations: [
        "native/publication-native.node",
        "native/index.js",
        "release.json",
        "runtime-integrity.json",
      ],
    },
  };
}

async function plannerAudit(f) {
  const path = join(
      activeRoot,
      "src/controls-publication/native-policy-reservation.ts",
    ),
    source = await readFile(path, "utf8");
  const from = "const capacity = { reservation, allocation };";
  assert.equal(source.split(from).length, 2);
  const instrumented = `${source.replace(
    from,
    "const capacity = { reservation, allocation, records };",
  )}\nexport {nativePlanCapacity as observeCapacity};\n`;
  const helper = join(f.evidence, "production-planner-observation.mjs");
  await writeFile(
    join(f.evidence, "planner-observation-adapter.ts"),
    instrumented,
  );
  await build({
    stdin: {
      contents: instrumented,
      resolveDir: join(activeRoot, "src/controls-publication"),
      loader: "ts",
    },
    outfile: helper,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
  const { observeCapacity } = await import(pathToFileURL(helper).href);
  const actual = await import(
    pathToFileURL(
      join(
        activeRoot,
        "dist/src/controls-publication/native-policy-reservation.js",
      ),
    ).href
  );
  const rows = await f.events(),
    results = [];
  for (const [kind, expectedRows] of [
    ["native-host-deployment-intent", 49],
    ["native-source-policy-install-intent", 70],
  ]) {
    const intent = rows.find((row) => row.record.kind === kind)?.record;
    assert.ok(intent);
    const observed = observeCapacity(intent),
      kinds = {};
    for (const row of observed.records)
      kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
    assert.deepEqual(observed.reservation, actual.reserveNativePlan(intent));
    assert.equal(observed.allocation, actual.nativePlanAllocation(intent));
    assert.equal(observed.records.length, expectedRows);
    assert.equal(kinds["native-selector-move-intent"], 3);
    assert.equal(kinds["native-selector-move-observed"], 3);
    assert.deepEqual(
      [
        ...new Set(
          observed.records
            .filter((row) => row.kind === "native-stage-reserved")
            .map((row) => row.scope.attemptNumber),
        ),
      ],
      [1, 2, 3],
    );
    results.push({
      kind,
      reservation: observed.reservation,
      allocation: observed.allocation,
      kinds,
    });
  }
  const rowCharge =
    18 * (256 + (64 + 2 * 256)) + 32 * 8 + 2 * (64 + 2 * 64) + (64 + 4 * 256);
  assert.equal(rowCharge, 16704);
  assert.equal(Math.floor((256 * 1024 * 1024) / rowCharge), 16070);
  for (let n = 1; n <= 16070; n++) {
    assert.ok(11 * n <= 18 * n);
    if (n >= 16) assert.ok(22.5 * n + 144 <= 32 * n);
    if (n >= 2) assert.ok(11136 <= 7 * 832 * n);
    else assert.ok(3328 + 640 <= 7 * 832 * n);
  }
  const result = {
    sourceSha256: hash(source),
    adapterSha256: hash(instrumented),
    adapterChange:
      "Expose the existing planner's retained records beside its unchanged return fields; compare reservation/allocation to actual compiled production exports",
    results,
    rowCharge,
    maxRowsBeforeNodes: 16070,
    membershipsPerRow: 11,
    chargedMemberships: 18,
    wholeHistoryArrays: 9,
    chargedReferenceSlotsPerRow: 32,
    fixedFloor: 11136,
    premise:
      "Conditional supported Node/V8 reachable replay/query/index projection. Source-profile header/property/slot/growth assumptions and reclamation of unreachable query generations remain trusted. Decoder/encoder/native/caller workspaces, total heap/RSS and infinite history are unproved.",
  };
  await writeFile(
    join(f.evidence, "planner-accounting.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}

async function physicalReadback(f) {
  const native = createRequire(import.meta.url)(f.addon),
    ok = (result) => {
      assert.equal(result.kind, "ok", JSON.stringify(result));
      return result.value;
    },
    handles = [],
    files = [];
  const rows = await f.events(),
    claims = rows
      .filter((row) => row.record.kind === "file-claimed")
      .map((row) => row.record);
  const component = (name) => ok(native.component(Buffer.from(name)));
  const anchor = ok(native.resolveAccountAnchor());
  handles.push(anchor.directory);
  const namespace = ok(
    native.openDirectoryNoFollow(
      anchor.directory,
      component("academic-os-control-publication"),
    ),
  );
  handles.push(namespace);
  async function walk(directory, path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert.ok(
        entry.isFile() || entry.isDirectory(),
        "Only ordinary fixture output entries are read",
      );
      const childPath = join(path, entry.name);
      if (entry.isDirectory()) {
        const child = ok(
          native.openDirectoryNoFollow(directory, component(entry.name)),
        );
        handles.push(child);
        await walk(child, childPath);
      } else {
        const file = ok(
          native.openRegularNoFollow(directory, component(entry.name), "read"),
        );
        handles.push(file);
        const observed = ok(native.observe(file));
        const claim = claims.find(
          (row) =>
            row.file.object.device === observed.object.device &&
            row.file.object.inode === observed.object.inode &&
            row.file.object.birthtimeNs === observed.object.birthtimeNs,
        );
        assert.ok(claim, `Output has a full generated claim ${childPath}`);
        assert.deepEqual(observed.object, claim.file.object);
        assert.deepEqual(observed.metadata, claim.file.metadata);
        assert.equal(observed.metadata.mode, 0o600);
        assert.equal(observed.metadata.linkCount, 1);
        const bytes = Buffer.from(
          ok(
            native.readBounded({
              file,
              maximumBytes: 1048576,
              exactLength: claim.planned.byteLength,
            }),
          ),
        );
        assert.equal(hash(bytes), claim.planned.byteSha256);
        assert.equal(bytes.length, claim.planned.byteLength);
        files.push({
          path: childPath,
          object: observed.object,
          metadata: observed.metadata,
          byteLength: bytes.length,
          sha256: hash(bytes),
        });
      }
    }
  }
  try {
    await walk(namespace, join(f.anchor, "academic-os-control-publication"));
  } finally {
    for (const handle of handles.reverse()) ok(native.close(handle));
  }
  const result = {
    files,
    allHandlesClosed: handles.length,
    sqliteSidecarContentsAccessed: false,
  };
  await writeFile(
    join(f.evidence, "native-physical-readback.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}
