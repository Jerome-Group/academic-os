import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { sha256 } from "../../src/checksum.js";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import { promisify } from "node:util";
import { createFilePreparedCompletionStore } from "../../src/tasks/file-prepared-completion-store.js";
import type { TaskExecutionPlan } from "../../src/tasks/task-execution-types.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "prepared-completion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "private");
  const excluded = join(root, "excluded");
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(excluded);
  const options = { stateRoot, excludedRoots: [excluded] };
  const plan: TaskExecutionPlan = {
    schemaVersion: 1,
    operationId: "fixture-operation",
    target: { kind: "module", key: "fixture", title: "Fixture" },
    listId: "fixture-list",
    expectedSnapshot: "a".repeat(64),
    operation: { name: "complete", taskId: "fixture-task" },
    policyVersion: "producer-supplied-policy",
  };
  const input = {
    packetJson: '{ "opaque": [1, 2], "unknown": true }\n',
    acquisitionEvidenceJson: '{"original":"observation"}',
    plan,
  };
  const store = createFilePreparedCompletionStore(options);
  const path = async () => {
    const name = (await readdir(stateRoot)).find((name) =>
      name.endsWith(".json"),
    );
    assert.ok(name);
    return join(stateRoot, name);
  };
  return { root, stateRoot, excluded, options, input, plan, store, path };
}

it("preserves exact opaque JSON and plan through a fresh process", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.store.read(f.plan.operationId), undefined);
  const prepared = await f.store.prepare(f.input);
  const script = `import { createFilePreparedCompletionStore } from ${JSON.stringify(new URL("../../src/tasks/file-prepared-completion-store.js", import.meta.url).href)};
const store = createFilePreparedCompletionStore(JSON.parse(process.argv[1]));
process.stdout.write(JSON.stringify(await store.read(process.argv[2])));`;
  const result = await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    script,
    JSON.stringify(f.options),
    f.plan.operationId,
  ]);
  assert.deepEqual(JSON.parse(result.stdout), prepared);
  assert.equal(prepared.packetJson, f.input.packetJson);
  assert.equal(
    prepared.acquisitionEvidenceJson,
    f.input.acquisitionEvidenceJson,
  );
  assert.deepEqual(prepared.plan, f.plan);
});

it("captures caller input before awaiting and returns detached snapshots", async (t) => {
  const f = await fixture(t);
  const original = structuredClone(f.input);
  const pending = f.store.prepare(f.input);
  f.input.plan.operation = { name: "complete", taskId: "changed" };
  f.input.packetJson = "{}";
  const result = await pending;
  assert.deepEqual(result.plan, original.plan);
  assert.equal(result.packetJson, original.packetJson);
  result.plan.operation = { name: "complete", taskId: "return-mutated" };
  const reread = await f.store.read(original.plan.operationId);
  assert.deepEqual(reread?.plan, original.plan);
});

it("identical retries preserve the publication; changed packet, evidence, or plan refuse", async (t) => {
  const f = await fixture(t);
  const expected = await f.store.prepare(f.input);
  const bytes = await readFile(await f.path(), "utf8");
  assert.deepEqual(await f.store.prepare(f.input), expected);
  for (const input of [
    { ...f.input, packetJson: "{}" },
    { ...f.input, acquisitionEvidenceJson: "{}" },
    { ...f.input, plan: { ...f.plan, policyVersion: "changed" } },
  ])
    await assert.rejects(f.store.prepare(input), /already binds/);
  assert.equal(await readFile(await f.path(), "utf8"), bytes);
});

it("concurrent identical and conflicting preparations never overwrite the winning identity", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    f.store.prepare(f.input),
    createFilePreparedCompletionStore(f.options).prepare(f.input),
    createFilePreparedCompletionStore(f.options).prepare({
      ...f.input,
      packetJson: '{"different":true}',
    }),
  ]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  const stored = await f.store.read(f.plan.operationId);
  assert.ok(stored);
  for (const result of results)
    if (result.status === "fulfilled") assert.deepEqual(result.value, stored);
  assert.deepEqual(
    await f.store.prepare({ ...f.input, packetJson: stored.packetJson }),
    stored,
  );
});

it("refuses unsafe roots and overlaps in either direction", async (t) => {
  const f = await fixture(t);
  await chmod(f.stateRoot, 0o755);
  await assert.rejects(f.store.prepare(f.input), /private/);
  await chmod(f.stateRoot, 0o700);
  const alias = join(f.root, "alias");
  await symlink(f.stateRoot, alias);
  await assert.rejects(
    createFilePreparedCompletionStore({ ...f.options, stateRoot: alias }).read(
      f.plan.operationId,
    ),
    /private/,
  );
  for (const excludedRoots of [[f.stateRoot], [f.root]])
    await assert.rejects(
      createFilePreparedCompletionStore({
        ...f.options,
        excludedRoots,
      }).prepare(f.input),
      /overlaps/,
    );
  const child = join(f.stateRoot, "excluded-child");
  await mkdir(child);
  await assert.rejects(
    createFilePreparedCompletionStore({
      ...f.options,
      excludedRoots: [child],
    }).prepare(f.input),
    /overlaps/,
  );
});

it("refuses insecure, linked, oversized, non-file and corrupted records", async (t) => {
  const f = await fixture(t);
  await f.store.prepare(f.input);
  const path = await f.path();
  const original = await readFile(path);
  await chmod(path, 0o644);
  await assert.rejects(f.store.read(f.plan.operationId), /Unsafe/);
  await chmod(path, 0o600);
  const alias = join(f.root, "hardlink");
  await link(path, alias);
  await assert.rejects(f.store.read(f.plan.operationId), /Unsafe/);
  await rm(alias);
  await writeFile(
    path,
    original.toString().replace("fixture-task", "tampered-task"),
  );
  await assert.rejects(f.store.read(f.plan.operationId), /binding|checksum/);
  const file = await open(path, "r+");
  await file.truncate(4 * 1024 * 1024 + 1);
  await file.close();
  await assert.rejects(f.store.read(f.plan.operationId), /oversized/);
  await rm(path);
  await symlink(alias, path);
  await assert.rejects(f.store.read(f.plan.operationId));
  await rm(path);
  await mkdir(path, { mode: 0o700 });
  await assert.rejects(f.store.read(f.plan.operationId), /Unsafe/);
});

it("rejects malformed or oversized JSON before creating state, and treats operation IDs only as opaque keys", async (t) => {
  const f = await fixture(t);
  for (const packetJson of ["{", `"${"x".repeat(4 * 1024 * 1024)}"`])
    await assert.rejects(f.store.prepare({ ...f.input, packetJson }));
  assert.deepEqual(await readdir(f.stateRoot), []);
  f.plan.operationId = "../../outside";
  await f.store.prepare(f.input);
  assert.equal(
    (await f.store.read(f.plan.operationId))?.operationId,
    "../../outside",
  );
  assert.ok(
    (await readdir(f.stateRoot)).every(
      (name) =>
        name === "journal-ownership" ||
        /^prepared-completion-[a-f0-9]{64}\.json$/u.test(name),
    ),
  );
});

it("recovers a killed publisher after exclusive link, and refuses concurrent reads during publication", {
  timeout: 10_000,
}, async (t) => {
  const f = await fixture(t);
  const script = `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const originalLink = fs.link;
fs.link = async (...args) => {
  await originalLink(...args);
  process.stdout.write("linked\\n");
  await new Promise(resolve => process.stdin.once("data", resolve));
};
syncBuiltinESMExports();
const { createFilePreparedCompletionStore } = await import(${JSON.stringify(new URL("../../src/tasks/file-prepared-completion-store.js", import.meta.url).href)});
await createFilePreparedCompletionStore(JSON.parse(process.argv[1])).prepare(JSON.parse(process.argv[2]));`;
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    script,
    JSON.stringify(f.options),
    JSON.stringify(f.input),
  ]);
  t.after(() => {
    child.kill("SIGKILL");
  });
  const barrier = await once(child.stdout, "data");
  assert.equal(String(barrier[0]), "linked\n");
  const path = await f.path();
  const temporary = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}.tmp`,
  );
  assert.equal((await lstat(path)).nlink, 2);
  await assert.rejects(
    f.store.read(f.plan.operationId),
    /Another invocation owns/,
  );
  assert.equal((await lstat(temporary)).nlink, 2);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const restarted = createFilePreparedCompletionStore(f.options);
  const recovered = await restarted.read(f.plan.operationId);
  assert.equal(recovered?.packetJson, f.input.packetJson);
  assert.deepEqual(recovered?.plan, f.plan);
  assert.equal((await lstat(path)).nlink, 1);
  await assert.rejects(lstat(temporary), { code: "ENOENT" });
  assert.deepEqual(await restarted.prepare(f.input), recovered);
});

it("recovery never removes foreign, unrelated or ambiguous hard links", async (t) => {
  const f = await fixture(t);
  await f.store.prepare(f.input);
  const path = await f.path();
  const temporary = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}.tmp`,
  );
  const foreign = join(f.root, "foreign-hard-link");
  await link(path, foreign);
  await assert.rejects(f.store.read(f.plan.operationId), /Unsafe/);
  await assert.rejects(f.store.prepare(f.input), /Unsafe/);
  assert.equal((await lstat(foreign)).nlink, 2);
  await link(path, temporary);
  await assert.rejects(f.store.read(f.plan.operationId), /Unsafe/);
  assert.equal((await lstat(temporary)).nlink, 3);
  await rm(foreign);
  await rm(temporary);
  await writeFile(temporary, await readFile(path), { mode: 0o600 });
  await link(path, foreign);
  await assert.rejects(f.store.read(f.plan.operationId), /Unsafe/);
  assert.notEqual((await lstat(temporary)).ino, (await lstat(path)).ino);
  assert.equal((await lstat(foreign)).nlink, 2);
  assert.equal((await lstat(temporary)).nlink, 1);
});

it("a corrupt interrupted publication preserves both links for reconciliation", async (t) => {
  const f = await fixture(t);
  await f.store.prepare(f.input);
  const path = await f.path();
  const temporary = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}.tmp`,
  );
  await link(path, temporary);
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace("fixture-task", "changed-task"),
  );
  await assert.rejects(f.store.read(f.plan.operationId), /binding|checksum/);
  assert.equal((await lstat(path)).nlink, 2);
  assert.equal((await lstat(temporary)).ino, (await lstat(path)).ino);
});

async function pausedPublisher(
  t: TestContext,
  f: Awaited<ReturnType<typeof fixture>>,
  point: "complete-temp" | "partial-temp" | "quarantine-link" | "after-unlink",
) {
  const script = `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const point = process.argv[3];
const original = { ...fs };
async function pause() {
  process.stdout.write("paused\\n");
  await new Promise(resolve => process.stdin.once("data", resolve));
}
fs.link = async (source, destination) => {
  if (point === "complete-temp" && destination.endsWith(".json")) await pause();
  await original.link(source, destination);
  if (point === "quarantine-link" && destination.endsWith(".quarantine")) await pause();
};
fs.unlink = async (path) => {
  await original.unlink(path);
  if (point === "after-unlink" && path.endsWith(".tmp")) await pause();
};
fs.open = async (path, ...args) => {
  const file = await original.open(path, ...args);
  if (point === "partial-temp" && path.endsWith(".tmp") && args[0] === "wx") {
    const write = file.writeFile.bind(file);
    file.writeFile = async (bytes) => { await write(bytes.slice(0, 19)); await pause(); };
  }
  return file;
};
syncBuiltinESMExports();
const { createFilePreparedCompletionStore } = await import(${JSON.stringify(new URL("../../src/tasks/file-prepared-completion-store.js", import.meta.url).href)});
await createFilePreparedCompletionStore(JSON.parse(process.argv[1])).prepare(JSON.parse(process.argv[2]));`;
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    script,
    JSON.stringify(f.options),
    JSON.stringify(f.input),
    point,
  ]);
  t.after(() => {
    child.kill("SIGKILL");
  });
  const barrier = await once(child.stdout, "data");
  assert.equal(String(barrier[0]), "paused\n");
  return async () => {
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  };
}

it("a killed pre-link complete temp resumes only the identical packet and plan", {
  timeout: 10_000,
}, async (t) => {
  const f = await fixture(t);
  const kill = await pausedPublisher(t, f, "complete-temp");
  await kill();
  const temporary = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}.tmp`,
  );
  const original = await readFile(temporary);
  await assert.rejects(
    f.store.prepare({ ...f.input, packetJson: "{}" }),
    /temp binds a different/,
  );
  assert.deepEqual(await readFile(temporary), original);
  const recovered = await createFilePreparedCompletionStore(f.options).prepare(
    f.input,
  );
  assert.deepEqual(recovered.plan, f.plan);
  assert.equal(recovered.packetJson, f.input.packetJson);
  await assert.rejects(lstat(temporary), { code: "ENOENT" });
});

it("a killed pre-link partial temp is preserved in quarantine before an identical retry", {
  timeout: 10_000,
}, async (t) => {
  const f = await fixture(t);
  const kill = await pausedPublisher(t, f, "partial-temp");
  await kill();
  const temporary = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}.tmp`,
  );
  const original = await readFile(temporary);
  assert.equal(original.length, 19);
  const recovered = await createFilePreparedCompletionStore(f.options).prepare(
    f.input,
  );
  assert.equal(recovered.packetJson, f.input.packetJson);
  const quarantines = (await readdir(f.stateRoot)).filter((name) =>
    name.endsWith(".quarantine"),
  );
  assert.equal(quarantines.length, 1);
  const path = join(f.stateRoot, quarantines[0] ?? "missing");
  assert.deepEqual(await readFile(path), original);
  assert.equal((await lstat(path)).mode & 0o7777, 0o600);
  assert.equal((await lstat(path)).nlink, 1);
});

it("a killed quarantine publication resumes without overwriting preserved partial bytes", {
  timeout: 10_000,
}, async (t) => {
  const f = await fixture(t);
  const temporary = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}.tmp`,
  );
  await writeFile(temporary, "partial original evidence", { mode: 0o600 });
  const kill = await pausedPublisher(t, f, "quarantine-link");
  assert.equal((await lstat(temporary)).nlink, 2);
  await kill();
  const recovered = await createFilePreparedCompletionStore(f.options).prepare(
    f.input,
  );
  assert.equal(recovered.packetJson, f.input.packetJson);
  const quarantines = (await readdir(f.stateRoot)).filter((name) =>
    name.endsWith(".quarantine"),
  );
  assert.equal(quarantines.length, 1);
  const path = join(f.stateRoot, quarantines[0] ?? "missing");
  assert.equal(await readFile(path, "utf8"), "partial original evidence");
  assert.equal((await lstat(path)).nlink, 1);
});

it("partial temp recovery refuses foreign links and conflicting quarantine without removing evidence", async (t) => {
  const f = await fixture(t);
  const temporary = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}.tmp`,
  );
  await writeFile(temporary, "partial", { mode: 0o600 });
  const foreign = join(f.root, "foreign-partial");
  await link(temporary, foreign);
  await assert.rejects(f.store.prepare(f.input));
  assert.equal((await lstat(temporary)).nlink, 2);
  await rm(foreign);
  const partialInfo = await lstat(temporary);
  const quarantine = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}-partial-${sha256("partial")}-${partialInfo.dev.toString(16)}-${partialInfo.ino.toString(16)}.quarantine`,
  );
  await writeFile(quarantine, "unrelated evidence", { mode: 0o600 });
  await assert.rejects(f.store.prepare(f.input), { code: "EEXIST" });
  assert.equal(await readFile(temporary, "utf8"), "partial");
  assert.equal(await readFile(quarantine, "utf8"), "unrelated evidence");
});

it("restart after unlink syncs the verified directory before returning; failed sync refuses", {
  timeout: 10_000,
}, async (t) => {
  const f = await fixture(t);
  const kill = await pausedPublisher(t, f, "after-unlink");
  assert.equal((await lstat(await f.path())).nlink, 1);
  await kill();
  const script = `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const options = JSON.parse(process.argv[1]);
const canonicalRoot = await fs.realpath(options.stateRoot);
const originalOpen = fs.open;
fs.open = async (path, ...args) => {
  const file = await originalOpen(path, ...args);
  if (path === canonicalRoot) {
    const originalSync = file.sync.bind(file);
    file.sync = async () => {
      if (process.argv[3] === "fail") throw new Error("directory sync failed");
      await originalSync();
      process.stdout.write("directory-synced\\n");
    };
  }
  return file;
};
syncBuiltinESMExports();
const { createFilePreparedCompletionStore } = await import(${JSON.stringify(new URL("../../src/tasks/file-prepared-completion-store.js", import.meta.url).href)});
const result = await createFilePreparedCompletionStore(options).read(process.argv[2]);
process.stdout.write("returned:" + result.operationId);`;
  const args = [
    "--input-type=module",
    "-e",
    script,
    JSON.stringify(f.options),
    f.plan.operationId,
  ];
  await assert.rejects(
    promisify(execFile)(process.execPath, [...args, "fail"]),
    /directory sync failed/,
  );
  const successful = await promisify(execFile)(process.execPath, [
    ...args,
    "pass",
  ]);
  assert.equal(
    successful.stdout,
    `directory-synced\nreturned:${f.plan.operationId}`,
  );
});

it("two identical pre-link partial crashes preserve both evidence files and permit the same-operation retry", {
  timeout: 10_000,
}, async (t) => {
  const f = await fixture(t);
  const temporary = join(
    f.stateRoot,
    `.prepared-completion-${sha256(f.plan.operationId)}.tmp`,
  );
  const firstKill = await pausedPublisher(t, f, "partial-temp");
  await firstKill();
  const firstBytes = await readFile(temporary);
  const firstInfo = await lstat(temporary);
  const secondKill = await pausedPublisher(t, f, "partial-temp");
  await secondKill();
  assert.deepEqual(await readFile(temporary), firstBytes);
  assert.notEqual((await lstat(temporary)).ino, firstInfo.ino);
  const before = (await readdir(f.stateRoot)).filter((name) =>
    name.endsWith(".quarantine"),
  );
  assert.equal(before.length, 1);
  const previousEvidence = join(f.stateRoot, before[0] ?? "missing");
  assert.equal((await lstat(previousEvidence)).ino, firstInfo.ino);
  const recovered = await createFilePreparedCompletionStore(f.options).prepare(
    f.input,
  );
  assert.equal(recovered.packetJson, f.input.packetJson);
  const after = (await readdir(f.stateRoot)).filter((name) =>
    name.endsWith(".quarantine"),
  );
  assert.equal(after.length, 2);
  for (const name of after) {
    const path = join(f.stateRoot, name);
    assert.deepEqual(await readFile(path), firstBytes);
    const info = await lstat(path);
    assert.equal(info.nlink, 1);
    assert.equal(info.mode & 0o7777, 0o600);
    assert.equal(info.uid, process.getuid?.());
  }
  assert.equal((await lstat(previousEvidence)).ino, firstInfo.ino);
  assert.deepEqual(await f.store.prepare(f.input), recovered);
});
