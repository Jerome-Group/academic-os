import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { alive } from "./fixture.mjs";

const repository = resolve(".");
assert.equal(process.platform, "darwin");
const parent = await realpath(tmpdir());
const parentStat = await lstat(parent);
assert.equal(parentStat.uid, process.getuid());
assert.equal(parentStat.mode & 0o777, 0o700);
const root = await mkdtemp(join(parent, "scanner-binding-"));
const installation = join(root, "installation");
const source = join(root, "source");
const commands = [];
const result = { outcome: "running", root, commands, mutations: [] };
process.stdout.write(`Evidence ${root}\n`);
try {
  await mkdir(source, { mode: 0o700 });
  await writeFile(join(source, "payload"), "ordered scanner binding fixture\n");
  await cp(join(repository, "dist/src"), join(installation, "dist/src"), {
    recursive: true,
    filter: async (path) => {
      assert.equal((await lstat(path)).isSymbolicLink(), false);
      return true;
    },
  });
  await copyFile(
    join(repository, "package.json"),
    join(installation, "package.json"),
  );
  const { installedRuntimeDependencyFiles } = await import(
    pathToFileURL(
      join(repository, "dist/src/controls-publication/runtime-dependencies.js"),
    )
  );
  const dependencies = await installedRuntimeDependencyFiles(repository);
  for (const path of dependencies) {
    assert.equal((await lstat(join(repository, path))).isSymbolicLink(), false);
    await mkdir(dirname(join(installation, path)), {
      recursive: true,
      mode: 0o700,
    });
    await copyFile(join(repository, path), join(installation, path));
  }
  result.copiedDependencyInputs = dependencies.length;
  const bindingPath = join(
    installation,
    "dist/src/migration/native-inventory/native/helper-binding.js",
  );
  const original = await readFile(bindingPath);
  const { helperBinding } = await import(pathToFileURL(bindingPath));
  assert.equal(helperBinding.encoding, "academic-os-native-inventory-helper/2");
  assert.deepEqual(
    helperBinding.sourceFiles.map(({ path }) => path),
    ["scan.c", "scan-core.c", "scan-core.h"],
  );

  async function inventory(name) {
    const command = spawnSync(
      process.execPath,
      [
        join(installation, "dist/src/cli.js"),
        "migration",
        "inventory",
        "--root",
        source,
        "--json",
        "--log",
        join(root, `${name}.json`),
      ],
      { encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
    );
    const observation = {
      name,
      pid: command.pid,
      status: command.status,
      signal: command.signal,
      aliveAfter: alive(command.pid),
      error: command.error?.message,
    };
    commands.push(observation);
    await writeFile(join(root, `${name}.stdout`), command.stdout ?? "");
    await writeFile(join(root, `${name}.stderr`), command.stderr ?? "");
    await writeFile(
      join(root, "commands.json"),
      JSON.stringify(commands, null, 2),
    );
    assert.equal(observation.aliveAfter, false);
    assert.equal(command.error, undefined);
    return { status: command.status, value: JSON.parse(command.stdout) };
  }
  const baseline = await inventory("baseline");
  assert.equal(baseline.status, 0);
  assert.equal(baseline.value.complete, true);
  result.sourceFingerprint = baseline.value.sourceFingerprint;
  const mutations = [
    [
      "reordered",
      (binding) => {
        binding.sourceFiles.reverse();
      },
    ],
    [
      "omitted",
      (binding) => {
        binding.sourceFiles.splice(1, 1);
      },
    ],
    [
      "duplicate",
      (binding) => {
        binding.sourceFiles[2] = binding.sourceFiles[1];
      },
    ],
    [
      "extra",
      (binding) => {
        binding.sourceFiles.push(binding.sourceFiles[0]);
      },
    ],
    [
      "unknown-encoding",
      (binding) => {
        binding.encoding = "academic-os-native-inventory-helper/3";
      },
    ],
    [
      "current-as-legacy",
      (binding) => {
        delete binding.encoding;
        delete binding.sourceFiles;
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const binding = structuredClone(helperBinding);
    mutate(binding);
    await writeFile(
      bindingPath,
      `export const helperBinding = ${JSON.stringify(binding)};\n`,
    );
    const refused = await inventory(name);
    assert.equal(refused.status, 2);
    assert.equal(refused.value.outcome, "refused");
    assert.equal(refused.value.sourceFingerprint, null);
    assert.ok(
      refused.value.diagnostics.some(
        ({ code }) => code === "invalid-adapter-binding",
      ),
    );
    await writeFile(bindingPath, original);
    const restored = await inventory(`${name}-restored`);
    assert.equal(restored.status, 0);
    assert.equal(restored.value.complete, true);
    assert.equal(
      restored.value.sourceFingerprint,
      baseline.value.sourceFingerprint,
    );
    assert.deepEqual(await readFile(bindingPath), original);
    result.mutations.push({
      name,
      refused: refused.value.outcome,
      restored: restored.value.outcome,
    });
  }
  const adapterPath = join(
    installation,
    "dist/src/migration/native-inventory/index.js",
  );
  const adapter = await readFile(adapterPath, "utf8");
  const guard = "source.path !== expected[index]";
  assert.equal(adapter.split(guard).length, 2);
  const reordered = structuredClone(helperBinding);
  reordered.sourceFiles.reverse();
  await writeFile(
    bindingPath,
    `export const helperBinding = ${JSON.stringify(reordered)};\n`,
  );
  await writeFile(adapterPath, adapter.replace(guard, "false"));
  const broken = await inventory("broken-order-guard");
  assert.equal(broken.status, 0);
  assert.equal(broken.value.complete, true);
  assert.equal(
    broken.value.sourceFingerprint,
    baseline.value.sourceFingerprint,
  );
  await writeFile(adapterPath, adapter);
  const guarded = await inventory("restored-order-guard");
  assert.equal(guarded.status, 2);
  assert.ok(
    guarded.value.diagnostics.some(
      ({ code }) => code === "invalid-adapter-binding",
    ),
  );
  await writeFile(bindingPath, original);
  const final = await inventory("final-restored");
  assert.equal(final.status, 0);
  assert.equal(final.value.sourceFingerprint, baseline.value.sourceFingerprint);
  assert.equal(await readFile(adapterPath, "utf8"), adapter);
  assert.deepEqual(await readFile(bindingPath), original);
  result.sensitivity = {
    mutation:
      "bypass source.path !== expected[index] in copied executing adapter",
    predictedWrongResult: "reordered binding returns complete inventory",
    broken: broken.value.outcome,
    restoredGuard: guarded.value.outcome,
    final: final.value.outcome,
  };
  result.outcome = "passed";
} catch (error) {
  result.outcome = "failed";
  result.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  result.teardown = commands.map(({ pid }) => ({ pid, alive: alive(pid) }));
  await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
}
