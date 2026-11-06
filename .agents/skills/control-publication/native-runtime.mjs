import assert from "node:assert/strict";
import { copyFile, lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decoded, hash } from "./fixture.mjs";
import { nativeFixture, success, raw } from "./native-fixture.mjs";
import { fullSuffix } from "./native-capacity.mjs";
import { packagedReceipt } from "./native-package.mjs";
const cases = (root) => [
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
      const text = await readFile(join(root, file), "utf8");
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
async function rechain(f, rows) {
  const { encodePublication } = await import(
    pathToFileURL(join(f.productRoot, "dist/src/controls-publication/codec.js"))
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
      key: "resolveAccountAnchor|after-call|none",
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
      violated: hit?.key === "resolveAccountAnchor|after-call|none",
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
export async function nativeMutations(root, evidence, only) {
  const results = [];
  for (const test of cases(root).filter(
    (test) => !only || test.name === only,
  )) {
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
