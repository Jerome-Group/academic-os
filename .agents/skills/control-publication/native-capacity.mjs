import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";
import { hash } from "./fixture.mjs";
import { success, refused } from "./native-fixture.mjs";
export async function fullSuffix(f) {
  const input = await f.prepare();
  const installed = success(await f.run("install-native-source-policy", input));
  const completed = success(f.create("capacity-completed"));
  const planner = await plannerAudit(f);
  const sourcePath = join(
    f.productRoot,
    "test/controls-publication/replay-capacity.test.ts",
  );
  const source = await readFile(sourcePath, "utf8"),
    prefix = source.slice(0, source.indexOf('it("shares immutable'));
  assert.ok(prefix.length > 1000);
  const helper = join(f.evidence, "production-padding.mjs");
  await build({
    stdin: {
      contents: `${prefix}\nexport {pad};`,
      resolveDir: join(f.productRoot, "test/controls-publication"),
      loader: "ts",
    },
    outfile: helper,
    bundle: true,
    banner: {
      js: 'import {createRequire as observationRequire} from "node:module";const require=observationRequire(import.meta.url);',
    },
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

async function plannerAudit(f) {
  const path = join(
      f.productRoot,
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
      resolveDir: join(f.productRoot, "src/controls-publication"),
      loader: "ts",
    },
    outfile: helper,
    bundle: true,
    banner: {
      js: 'import {createRequire as observationRequire} from "node:module";const require=observationRequire(import.meta.url);',
    },
    platform: "node",
    format: "esm",
    target: "node24",
  });
  const { observeCapacity } = await import(pathToFileURL(helper).href);
  const actual = await import(
    pathToFileURL(
      join(
        f.productRoot,
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
