import assert from "node:assert/strict";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import {
  createFileTaskLifecycleStore,
  type TaskLifecycleMutationSession,
} from "../../src/tasks/file-task-lifecycle-store.js";
import {
  taskLifecycleDecision,
  type TaskLifecycleEntry,
} from "../../src/tasks/task-lifecycle.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "academic-os-lifecycle-fixture-"));
  roots.push(root);
  const stateRoot = join(root, "private-state");
  const excluded = join(root, "synthetic-drive");
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(excluded);
  const input = { stateRoot, excludedRoots: [excluded] };
  return {
    root,
    stateRoot,
    excluded,
    input,
    store: createFileTaskLifecycleStore(input),
    path: join(stateRoot, "task-lifecycle.json"),
  };
}
function entry(): TaskLifecycleEntry {
  return {
    target: { kind: "module", key: "fixture" },
    occurrenceId: "source:1",
    source: { kind: "source", id: "source" },
    disposition: "owner-dismissed",
    recordedAt: "2026-10-28T09:00:00Z",
    evidenceRef: "fixture-owner-dismissal",
    providers: [],
  };
}

it("atomically persists private tombstones across reopened stores outside Drive", async () => {
  const test = await fixture();
  assert.equal((await test.store.read()).revision, 0);
  await test.store.withMutation((session) => session.record(entry()));
  const reopened = createFileTaskLifecycleStore(test.input);
  assert.deepEqual(taskLifecycleDecision(await reopened.read(), entry()), {
    allowed: false,
    reason: "owner-dismissed",
  });
  assert.equal((await stat(test.path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(test.excluded), []);
  assert.ok(
    (await readdir(test.stateRoot)).every((name) => !name.endsWith(".tmp")),
  );
  assert.equal(JSON.parse(await readFile(test.path, "utf8")).schemaVersion, 1);
});

it("holds one mutation owner across the caller's provider effect and expires escaped sessions", async () => {
  const test = await fixture();
  let escaped: TaskLifecycleMutationSession | undefined;
  let release!: () => void;
  let admitted!: () => void;
  const ready = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = test.store.withMutation(async (session) => {
    escaped = session;
    await session.record(entry());
    admitted();
    await gate;
  });
  await ready;
  let competingEffects = 0;
  await assert.rejects(
    createFileTaskLifecycleStore(test.input).withMutation(async () => {
      competingEffects++;
    }),
    /Another invocation owns/u,
  );
  assert.equal(competingEffects, 0);
  release();
  await first;
  assert.ok(escaped);
  await assert.rejects(escaped.record(entry()), /expired/u);
  await test.store.withMutation(async (session) => {
    assert.equal((await session.read()).revision, 1);
  });
});

it("drains admitted unawaited writes before releasing ownership", async () => {
  const test = await fixture();
  await test.store.withMutation(async (session) => {
    void session.record(entry());
  });
  assert.equal((await test.store.read()).entries.length, 1);
});

it("refuses public roots, unsafe files, symlinks and malformed state without changing them", async () => {
  const test = await fixture();
  const inside = join(test.excluded, "private");
  await mkdir(inside, { mode: 0o700 });
  await assert.rejects(
    createFileTaskLifecycleStore({ ...test.input, stateRoot: inside }).read(),
    /outside Drive/u,
  );
  await chmod(test.stateRoot, 0o755);
  await assert.rejects(test.store.read(), /private ordinary directory/u);
  await chmod(test.stateRoot, 0o700);
  await writeFile(test.path, "{partial", { mode: 0o600 });
  await assert.rejects(
    test.store.withMutation((session) => session.record(entry())),
  );
  assert.equal(await readFile(test.path, "utf8"), "{partial");
  await rm(test.path);
  const real = join(test.root, "outside.json");
  await writeFile(real, "{}", { mode: 0o600 });
  await symlink(real, test.path);
  await assert.rejects(test.store.read());
  await rm(test.path);
  await link(real, test.path);
  await assert.rejects(test.store.read(), /Unsafe/u);
  assert.equal(await readFile(real, "utf8"), "{}");
});
