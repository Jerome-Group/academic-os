import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { build } from "esbuild";
import { isRecord } from "../../src/conformance/value-shape.js";
import {
  digest,
  encodePublication,
  sha256,
} from "../../src/controls-publication/codec.js";
import { fixture, raw, repository } from "./native-policy-fixture.js";

const base = "53069cd55db399cef26d88ae806bb71c54e914bf";

it("installs, updates and retries exact policy receipts through host and extracted deployment entrypoints", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("lifecycle");
  context.diagnostic(`Retained native policy fixture ${f.root}`);
  const input = await f.request();
  const installed = await f.run("install-native-source-policy", input);
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  assert.equal(
    installed.value.schema,
    "native-source-policy-install-receipt/1",
  );
  assert.ok(isRecord(installed.value.generation));
  const prior = installed.value.generation.sha256;
  assert.equal(typeof prior, "string");
  const retry = await f.run(
    "retry-native-source-policy",
    input.requestId,
    f.extracted,
  );
  assert.equal(retry.status, 0, JSON.stringify(retry.value));
  assert.deepEqual(retry.value, installed.value);
  const wrong = await f.run("install-native-source-policy", {
    ...input,
    requestId: "wrong-old",
    expectedPriorGeneration: "0".repeat(64),
  });
  assert.equal(wrong.value.code, "stale-head");
  assert.equal(typeof prior, "string");
  const update = await f.run(
    "install-native-source-policy",
    {
      ...input,
      requestId: "install-two",
      expectedPriorGeneration: prior,
      slots: [{ ...input.slots[0], sourceKey: "private-two" }],
    },
    f.extracted,
  );
  assert.equal(update.status, 0, JSON.stringify(update.value));
  const historical = await f.run("retry-native-source-policy", input.requestId);
  assert.equal(historical.status, 0, JSON.stringify(historical.value));
  assert.deepEqual(historical.value, installed.value);
  const records = await f.records();
  assert.equal(
    records.filter((row) => row.kind === "native-source-policy-receipt-settled")
      .length,
    2,
  );
  const firstIntent = records.find(
    (row) => row.kind === "native-host-deployment-intent",
  );
  assert.ok(firstIntent);
  assert.ok(
    records.indexOf(firstIntent) <
      records.findIndex((row) => row.kind === "directory-claimed"),
  );
  const namespace = join(f.anchor, "academic-os-control-publication");
  const generations = records.filter(
    (row) => row.kind === "native-source-policy-generation-settled",
  );
  for (const generation of generations)
    if (generation.kind === "native-source-policy-generation-settled") {
      const path = join(
        namespace,
        "native-source-policy",
        `${generation.blob.sha256}.json`,
      );
      assert.equal(sha256(await readFile(path)), generation.blob.sha256);
      assert.equal((await stat(path)).mode & 0o7777, 0o600);
    }
});

it("refuses unavailable registration and unsafe private roots before policy intent", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("refusals");
  context.diagnostic(`Retained native policy refusal fixture ${f.root}`);
  const unavailable = await f.run("install-native-source-policy", {
    requestId: "none",
    deploymentRegistrationDigest: "0".repeat(64),
    slots: [],
    expectedPriorGeneration: null,
  });
  assert.notEqual(unavailable.status, 0);
  const input = await f.request();
  await chmod(f.enclosure, 0o755);
  const unsafe = await f.run("install-native-source-policy", input);
  assert.notEqual(unsafe.status, 0);
  assert.equal(unsafe.value.code, "unsafe-namespace");
  assert.equal(
    (await f.records()).some(
      (row) => row.kind === "native-source-policy-install-intent",
    ),
    false,
  );
  await chmod(f.enclosure, 0o700);
  const overlap = await f.run("install-native-source-policy", {
    ...input,
    slots: [
      { ...input.slots[0], snapshotLocatorBase64: raw(join(f.root, "live")) },
    ],
  });
  assert.notEqual(overlap.status, 0);
  assert.equal(overlap.value.code, "unsafe-namespace");
  const before = await readFile(f.ledger);
  const acquisition = f.command([
    join(f.host, "publication.mjs"),
    "install-native-source-policy",
    "--input",
    join(f.root, "input-1.json"),
  ]);
  assert.notEqual(acquisition.status, 0);
  assert.deepEqual(await readFile(f.ledger), before);
  await rename(f.config, join(f.root, "configuration-unavailable.json"));
  const changed = await f.run("install-native-source-policy", input);
  assert.notEqual(changed.status, 0);
  assert.deepEqual(await readFile(f.ledger), before);
});

for (const boundary of [
  {
    name: "generation-claimed",
    edge: "before-file-sync",
    kind: "native-source-policy-generation-settled",
    action: "throw",
  },
  { name: "selector-swap", edge: "after-policy-selector-swap", action: "kill" },
  {
    name: "receipt-intent",
    edge: "after-create-regular",
    kind: "native-source-policy-receipt-intent",
    action: "throw",
  },
])
  it(`retries retained ${boundary.name} interruption without adopting unknown residue`, {
    skip: process.platform !== "darwin",
    timeout: 180000,
  }, async (context) => {
    const f = await fixture(boundary.name);
    context.diagnostic(`Retained native policy boundary fixture ${f.root}`);
    const input = await f.request();
    await writeFile(f.checkpoint, JSON.stringify(boundary));
    const interrupted = await f.run("install-native-source-policy", input);
    assert.notEqual(interrupted.status, 0);
    const marker: unknown = JSON.parse(
      await readFile(join(f.root, "fault-hit.json"), "utf8"),
    );
    assert.ok(isRecord(marker));
    assert.equal(marker.edge, boundary.edge);
    await unlink(f.checkpoint);
    const before = await f.records();
    const ledgerBefore = await readFile(f.ledger);
    const blocked = f.command([
      join(f.host, "publication.mjs"),
      "create-generated-candidate",
      "--request",
      "unrelated-generated",
      "--identity",
      f.identityPath,
    ]);
    assert.notEqual(blocked.status, 0);
    const blockedValue: unknown = JSON.parse(blocked.stdout);
    assert.ok(isRecord(blockedValue));
    assert.equal(blockedValue.requestId, input.requestId);
    assert.deepEqual(await readFile(f.ledger), ledgerBefore);
    let retried = await f.run(
      "retry-native-source-policy",
      input.requestId,
      f.extracted,
    );
    if (boundary.name === "receipt-intent") {
      assert.equal(retried.value.code, "uncertain-claim");
      assert.equal(
        (await f.records()).filter(
          (row) => row.kind === "native-attempt-retained",
        ).length,
        1,
      );
      retried = await f.run("retry-native-source-policy", input.requestId);
    }
    assert.equal(retried.status, 0, JSON.stringify(retried.value));
    const after = await f.records();
    assert.equal(
      after.filter((row) => row.kind === "native-source-policy-install-intent")
        .length,
      1,
    );
    assert.equal(
      after.filter((row) => row.kind === "native-source-policy-receipt-settled")
        .length,
      1,
    );
    assert.ok(after.length > before.length);
    const repeated = await f.run("retry-native-source-policy", input.requestId);
    assert.equal(repeated.status, 0, JSON.stringify(repeated.value));
    assert.deepEqual(repeated.value, retried.value);
  });

it("retains unclaimed registration directories and exhausts exactly three attempts", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("attempt-limit");
  context.diagnostic(`Retained native policy attempt-limit fixture ${f.root}`);
  await writeFile(
    f.checkpoint,
    JSON.stringify({
      edge: "after-create-directory",
      kind: "native-stage-reserved",
      action: "throw",
    }),
  );
  const interrupted = await f.run("register", f.registrationInput);
  assert.notEqual(interrupted.status, 0);
  await unlink(f.checkpoint);
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await f.run("register", f.registrationInput);
    assert.equal(result.value.code, "uncertain-claim");
  }
  const records = await f.records();
  assert.equal(
    records.filter((row) => row.kind === "native-stage-reserved").length,
    3,
  );
  assert.equal(
    records.filter((row) => row.kind === "native-attempt-retained").length,
    3,
  );
  const bytes = await readFile(f.ledger);
  const exhausted = await f.run("register", f.registrationInput);
  assert.equal(exhausted.value.code, "uncertain-claim");
  assert.match(
    JSON.stringify(exhausted.value),
    /Three retained native attempts/u,
  );
  assert.deepEqual(await readFile(f.ledger), bytes);
  assert.equal(
    records.some((row) => row.kind === "native-host-deployment-settled"),
    false,
  );
});

it("refuses an equal-byte replacement of the selected policy before publisher writes", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("equal-byte");
  context.diagnostic(`Retained native policy equal-byte fixture ${f.root}`);
  const input = await f.request();
  const installed = await f.run("install-native-source-policy", input);
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  const selector = join(
    f.anchor,
    "academic-os-control-publication/native-source-policy.json",
  );
  const original = await stat(selector);
  const bytes = await readFile(selector);
  await rename(selector, join(f.root, "retained-original-selector.json"));
  await writeFile(selector, bytes, { mode: 0o600 });
  assert.notEqual((await stat(selector)).ino, original.ino);
  const ledger = await readFile(f.ledger);
  const refused = await f.run("install-native-source-policy", {
    ...input,
    requestId: "foreign-selector",
    expectedPriorGeneration: isRecord(installed.value.generation)
      ? installed.value.generation.sha256
      : null,
  });
  assert.equal(refused.value.code, "root-replaced");
  assert.deepEqual(await readFile(selector), bytes);
  assert.deepEqual(await readFile(f.ledger), ledger);
});

it("runs the actual older release against the first new-family intent and refuses before generated effects", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("older-release");
  context.diagnostic(`Retained actual older release fixture ${f.root}`);
  await writeFile(
    f.checkpoint,
    JSON.stringify({
      edge: "before-create-directory",
      kind: "native-stage-reserved",
      action: "throw",
    }),
  );
  const interrupted = await f.run("register", f.registrationInput);
  assert.notEqual(interrupted.status, 0);
  await unlink(f.checkpoint);
  const oldSource = join(f.root, "older-source"),
    output = join(f.root, "older-extracted");
  await mkdir(oldSource, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(output, "native"), { mode: 0o700 });
  const archive = spawnSync(
    "git",
    ["archive", base, "src", "scripts", "package.json", "package-lock.json"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(archive.status, 0, archive.stderr.toString());
  const extracted = spawnSync("tar", ["-xf", "-", "-C", oldSource], {
    input: archive.stdout,
    encoding: "utf8",
  });
  assert.equal(extracted.status, 0, extracted.stderr);
  await symlink(
    join(repository, "node_modules"),
    join(oldSource, "node_modules"),
  );
  const addon = join(output, "native/publication-native.node");
  const compiled = f.command([
    join(oldSource, "scripts/build-control-publication-native.mjs"),
    "--fixture-anchor",
    f.anchor,
    "--output",
    addon,
  ]);
  assert.equal(compiled.status, 0, compiled.stderr);
  const marker = join(f.root, "older-generated-effects.json"),
    loader = join(f.root, "older-loader.ts");
  await writeFile(
    loader,
    `import {createRequire} from 'node:module';import {writeFileSync} from 'node:fs';import {isPublicationNative} from ${JSON.stringify(join(oldSource, "src/controls-publication/native/index.ts"))};export function loadPublicationNative(){const value=createRequire(import.meta.url)('./native/publication-native.node');if(!isPublicationNative(value)||value.buildKind!=='fixture')throw Error('Old fixture addon required');value.setFixtureCheckpoint((edge)=>{if(['before-file-sync','before-create-directory','before-create-regular','before-write','before-truncate','before-head-rename','before-exclusive-promote'].includes(edge))writeFileSync(${JSON.stringify(marker)},JSON.stringify({edge,pid:process.pid}));});return {kind:'ok',value};}`,
  );
  await build({
    entryPoints: [join(oldSource, "src/controls-publication/standalone.ts")],
    outfile: join(output, "publication.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import {createRequire as oldRequire} from "node:module";const require=oldRequire(import.meta.url);',
    },
    plugins: [
      {
        name: "old-fixture-account",
        setup(plugin) {
          plugin.onResolve({ filter: /\.\/native\/index\.js$/ }, (args) =>
            args.importer.endsWith("/owner.ts") ? { path: loader } : undefined,
          );
        },
      },
    ],
  });
  const names = spawnSync(
    "git",
    ["ls-tree", "-r", "--name-only", base, "src"],
    { encoding: "utf8" },
  );
  assert.equal(names.status, 0, names.stderr);
  const bindings = [];
  for (const path of [
    ...names.stdout.trimEnd().split("\n"),
    "package-lock.json",
    "scripts/build-control-publication-native.mjs",
    "scripts/build-control-publication-release.mjs",
    "scripts/check-control-publication-imports.mjs",
    "scripts/build-control-publication-standalone.mjs",
  ].sort())
    bindings.push({
      path,
      sha256: sha256(await readFile(join(oldSource, path))),
    });
  const manifest = {
    encoding: "academic-os-publication-release/1",
    sourceDigest: digest(bindings),
    nativeDigest: sha256(await readFile(addon)),
    sourceBindings: bindings,
  };
  await writeFile(join(output, "release.json"), encodePublication(manifest));
  const before = await readFile(f.ledger);
  const refused = f.command([
    join(output, "publication.mjs"),
    "create-generated-candidate",
    "--request",
    "older-create",
    "--identity",
    f.identityPath,
  ]);
  const value: unknown = JSON.parse(refused.stdout);
  assert.ok(isRecord(value));
  assert.equal(value.kind, "recovery-required");
  assert.equal(value.code, "journal-recovery-required");
  assert.match(JSON.stringify(value), /strict supported JSON/u);
  assert.deepEqual(await readFile(f.ledger), before);
  await assert.rejects(stat(marker), { code: "ENOENT" });
  await writeFile(
    join(f.root, "older-release-bindings.json"),
    JSON.stringify(
      {
        base,
        archiveSha256: sha256(archive.stdout),
        manifest,
        executableSha256: sha256(
          await readFile(join(output, "publication.mjs")),
        ),
        oldEffectsObserved: false,
        ledgerUnchanged: true,
        commands: f.commands,
      },
      null,
      2,
    ),
  );
});

it("holds the permanent account gate while the synchronous installer is stopped", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("same-gate");
  context.diagnostic(`Retained native policy same-gate fixture ${f.root}`);
  const input = await f.request();
  const path = join(f.root, "stopped-install.json");
  await writeFile(path, JSON.stringify(input), { mode: 0o600 });
  await writeFile(
    f.checkpoint,
    JSON.stringify({ edge: "after-policy-selector-swap", action: "stop" }),
  );
  const child = spawn(
    process.execPath,
    [f.hostEntry, "install-native-source-policy", "--input", path],
    { cwd: repository, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (value: Buffer) => {
    stdout += value.toString();
  });
  child.stderr.on("data", (value: Buffer) => {
    stderr += value.toString();
  });
  const completed = new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) =>
    child.once("close", (status, signal) => resolve({ status, signal })),
  );
  try {
    let hit = false;
    for (let count = 0; count < 500; count++) {
      try {
        const value: unknown = JSON.parse(
          await readFile(join(f.root, "fault-hit.json"), "utf8"),
        );
        if (isRecord(value) && value.pid === child.pid) {
          hit = true;
          break;
        }
      } catch {}
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(hit, true, stdout + stderr);
    const before = await readFile(f.ledger);
    const contender = await f.run(
      "retry-native-source-policy",
      input.requestId,
      f.extracted,
    );
    assert.equal(contender.value.code, "busy", JSON.stringify(contender.value));
    assert.deepEqual(await readFile(f.ledger), before);
    child.kill("SIGCONT");
    const result = await completed;
    assert.equal(result.status, 0, stdout + stderr);
    assert.equal(result.signal, null);
    const receipt: unknown = JSON.parse(stdout);
    assert.ok(isRecord(receipt));
    assert.equal(receipt.schema, "native-source-policy-install-receipt/1");
    if (child.pid) assert.throws(() => process.kill(child.pid ?? -1, 0));
    await writeFile(
      join(f.root, "stopped-owner.json"),
      JSON.stringify(
        {
          pid: child.pid,
          ...result,
          stdout,
          stderr,
          contender: contender.value,
          aliveAfter: false,
        },
        null,
        2,
      ),
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGCONT");
      child.kill("SIGKILL");
    }
    await completed;
  }
});
