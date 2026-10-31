import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { createFileTaskRecoveryStore } from "../../src/tasks/file-task-recovery-store.js";
import type { NativeTaskTimingObservation } from "../../src/tasks/native-task-timing.js";
import type {
  TaskRecoveryCapture,
  TaskRecoveryRetention,
} from "../../src/tasks/task-recovery-types.js";

const roots: string[] = [];
const target = {
  kind: "module" as const,
  key: "synthetic/module",
  title: "Synthetic module",
};
const initialTime = "2026-10-28T08:00:00.000Z";
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(retention?: TaskRecoveryRetention) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-recovery-fixture-"));
  roots.push(root);
  const stateRoot = join(root, "private");
  const excluded = join(root, "synthetic-drive");
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(excluded);
  let currentTime = initialTime;
  const input = {
    stateRoot,
    excludedRoots: [excluded],
    now: () => currentTime,
    ...(retention === undefined ? {} : { retention }),
  };
  return {
    root,
    stateRoot,
    excluded,
    input,
    directory: join(stateRoot, "task-recovery"),
    store: createFileTaskRecoveryStore(input),
    setTime(value: string) {
      currentTime = value;
    },
  };
}

function capture(title = "Synthetic task"): TaskRecoveryCapture {
  return {
    target: { ...target },
    listId: "synthetic-list",
    register: {
      listId: "synthetic-list",
      tasks: [
        {
          taskId: "task-1",
          title,
          status: "open",
          notes: "Historical register notes",
        },
      ],
    },
    live: [
      {
        id: "task-1",
        title,
        status: "needsAction",
        notes: "Observed description",
        hidden: false,
        position: "0001",
      },
    ],
    reason: "refresh",
  };
}

it("publishes immutable private snapshots and deduplicates unchanged projected observations", async () => {
  const test = await fixture();
  const original = capture();
  const first = await test.store.capture(original);
  const path = join(test.directory, `${first.snapshotId}.json`);
  const originalBytes = await readFile(path, "utf8");
  assert.equal((await stat(test.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(first.coverage, {
    planningTimeZone: "Asia/Singapore",
    provider: "complete-observation",
    register: "historical-local-state",
    nativeTiming: "unavailable",
  });
  assert.equal(first.nativeTiming.status, "unsupported");
  test.setTime("2026-10-28T09:00:00.000Z");
  const duplicate = await test.store.capture(original);
  assert.equal(duplicate.snapshotId, first.snapshotId);
  assert.equal(duplicate.capturedAt, initialTime);
  assert.equal(await readFile(path, "utf8"), originalBytes);
  const originalTask = original.live[0];
  const returnedTask = first.live[0];
  assert.ok(originalTask);
  assert.ok(returnedTask);
  originalTask.notes = "later input mutation";
  returnedTask.notes = "later result mutation";
  assert.equal(
    (await test.store.read(first.snapshotId)).live[0]?.notes,
    "Observed description",
  );
  assert.equal((await test.store.list(target)).length, 1);
  assert.deepEqual(
    await test.store.list({ ...target, key: "another-target" }),
    [],
  );
  assert.deepEqual(await readdir(test.excluded), []);
  await assert.rejects(test.store.read("../outside"), /identity/u);
});

it("projects away raw auth, provider errors and unknown fields without changing caller data", async () => {
  const test = await fixture();
  const original = capture();
  const registerEntry = original.register.tasks[0];
  const liveTask = original.live[0];
  assert.ok(registerEntry);
  assert.ok(liveTask);
  const extra = {
    ...capture(),
    access_token: "discarded-auth-value",
    providerError: "discarded-provider-error",
    target: { ...target, credentials: "discarded-target-extra" },
    live: [
      {
        ...liveTask,
        authorization: "discarded-live-extra",
        raw: { token: "discarded-nested-auth" },
      },
    ],
    register: {
      ...capture().register,
      raw: "discarded-register-extra",
      tasks: [
        {
          ...registerEntry,
          providerError: "discarded-row-extra",
          provenance: {
            assessment: "synthetic assessment",
            token: "discarded-provenance-extra",
          },
        },
      ],
    },
    operation: {
      operationId: "operation-1",
      planDigest: "synthetic-digest",
      phase: "before-send",
      taskId: null,
      providerError: "discarded-operation-extra",
    },
    sources: [
      {
        taskId: "task-1",
        sourceOccurrenceId: "source:1",
        operationId: "operation-1",
        planDigest: "synthetic-digest",
        raw: "discarded-source-extra",
      },
    ],
  };
  Object.freeze(extra.live[0]);
  Object.freeze(extra.register.tasks[0]);
  Object.freeze(extra.target);
  const before = JSON.stringify(extra);
  const snapshot = await test.store.capture(extra);
  assert.equal(JSON.stringify(extra), before);
  const bytes = await readFile(
    join(test.directory, `${snapshot.snapshotId}.json`),
    "utf8",
  );
  assert.equal(bytes.includes("discarded-"), false);
  assert.equal(
    snapshot.register.tasks[0]?.provenance?.assessment,
    "synthetic assessment",
  );
  assert.equal(snapshot.sources?.[0]?.sourceOccurrenceId, "source:1");
  await assert.rejects(
    test.store.capture({
      ...capture(),
      live: [{ id: "task-1", notes: `Bearer ${"x".repeat(32)}` }],
    }),
    /credential-shaped/u,
  );
  assert.equal((await test.store.list(target)).length, 1);
});

it("preserves assigned Task source identities and empty assignment evidence while projecting away nested extras", async () => {
  const test = await fixture();
  const observation = {
    ...capture(),
    live: [
      {
        id: "task-1",
        title: "Assigned synthetic task",
        assignmentInfo: {
          surfaceType: "DOCUMENT",
          access_token: `Bearer ${"x".repeat(32)}`,
          linkToTask: "discarded-assignment-link",
          driveResourceInfo: {
            driveFileId: "synthetic-drive-file-1",
            resourceKey: "discarded-resource-key",
            authorization: "discarded-resource-auth",
          },
          spaceInfo: {
            space: "spaces/synthetic-1",
            token: "discarded-space-auth",
            raw: { error: "discarded-space-error" },
          },
        },
      },
      {
        id: "task-2",
        title: "Assigned task with unavailable source details",
        assignmentInfo: {},
      },
    ],
  };
  const snapshot = await test.store.capture(observation);
  const reopened = await createFileTaskRecoveryStore(test.input).read(
    snapshot.snapshotId,
  );
  assert.deepEqual(reopened.live[0]?.assignmentInfo, {
    surfaceType: "DOCUMENT",
    driveResourceInfo: { driveFileId: "synthetic-drive-file-1" },
    spaceInfo: { space: "spaces/synthetic-1" },
  });
  assert.deepEqual(reopened.live[1]?.assignmentInfo, {});
  const bytes = await readFile(
    join(test.directory, `${snapshot.snapshotId}.json`),
    "utf8",
  );
  assert.equal(bytes.includes("discarded-"), false);
  assert.equal(bytes.includes("Bearer"), false);
  assert.equal(
    (await test.store.capture(observation)).snapshotId,
    snapshot.snapshotId,
  );
  await assert.rejects(
    test.store.capture({
      ...capture(),
      live: [
        {
          id: "task-1",
          assignmentInfo: { surfaceType: `Bearer ${"x".repeat(32)}` },
        },
      ],
    }),
    /credential-shaped/u,
  );
});

it("validates checksums and rejects unsafe files without pruning or repairing them", async () => {
  const test = await fixture();
  const snapshot = await test.store.capture(capture());
  const path = join(test.directory, `${snapshot.snapshotId}.json`);
  const original = await readFile(path, "utf8");
  const altered = original.replace(
    "Observed description",
    "Corrupt description",
  );
  await writeFile(path, altered);
  await assert.rejects(test.store.read(snapshot.snapshotId), /checksum/u);
  await assert.rejects(test.store.capture(capture("Next task")), /checksum/u);
  assert.equal(await readFile(path, "utf8"), altered);
  await writeFile(path, original);
  await chmod(path, 0o644);
  await assert.rejects(test.store.read(snapshot.snapshotId), /Unsafe/u);
  await chmod(path, 0o600);
  const alias = join(test.root, "snapshot-alias");
  await link(path, alias);
  await assert.rejects(test.store.read(snapshot.snapshotId), /Unsafe/u);
  await rm(alias);
  await rm(path);
  const outside = join(test.root, "outside.json");
  await writeFile(outside, original, { mode: 0o600 });
  await symlink(outside, path);
  await assert.rejects(test.store.read(snapshot.snapshotId));
  assert.equal(await readFile(outside, "utf8"), original);
});

it("refuses excluded roots, public permissions and linked recovery directories", async () => {
  const test = await fixture();
  const inside = join(test.excluded, "private");
  await mkdir(inside, { mode: 0o700 });
  await assert.rejects(
    createFileTaskRecoveryStore({ ...test.input, stateRoot: inside }).capture(
      capture(),
    ),
    /outside Drive/u,
  );
  const nestedExcluded = join(test.stateRoot, "academic-target");
  await mkdir(nestedExcluded, { mode: 0o700 });
  await assert.rejects(
    createFileTaskRecoveryStore({
      ...test.input,
      excludedRoots: [nestedExcluded],
    }).capture(capture()),
    /outside Drive/u,
  );
  assert.deepEqual(await readdir(nestedExcluded), []);
  await chmod(test.stateRoot, 0o755);
  await assert.rejects(test.store.list(target), /private ordinary/u);
  await chmod(test.stateRoot, 0o700);
  const outside = join(test.root, "other-private");
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, test.directory);
  await assert.rejects(test.store.capture(capture()), /private ordinary/u);
  assert.deepEqual(await readdir(outside), []);
});

it("bounds snapshot count across targets and expires only verified older snapshots", async () => {
  const test = await fixture({
    maxSnapshots: 2,
    maxAgeDays: 2,
    maxBytes: 1_000_000,
  });
  const first = await test.store.capture(capture("First"));
  test.setTime("2026-10-29T08:00:00.000Z");
  const second = await test.store.capture({
    ...capture("Second"),
    target: { ...target, key: "other-target" },
  });
  test.setTime("2026-10-30T08:00:00.000Z");
  const third = await test.store.capture(capture("Third"));
  await assert.rejects(test.store.read(first.snapshotId), { code: "ENOENT" });
  assert.equal(
    (await test.store.read(second.snapshotId)).snapshotId,
    second.snapshotId,
  );
  assert.equal(
    (await test.store.list(target))[0]?.snapshotId,
    third.snapshotId,
  );
  test.setTime("2026-11-04T08:00:00.000Z");
  const fourth = await test.store.capture(capture("Third"));
  assert.notEqual(fourth.snapshotId, third.snapshotId);
  await assert.rejects(test.store.read(third.snapshotId), { code: "ENOENT" });
  assert.equal(
    (await readdir(test.directory)).filter((name) => !name.startsWith("."))
      .length,
    1,
  );
});

it("bounds snapshot bytes and fails closed when partial evidence consumes the remaining capacity", async () => {
  const test = await fixture({
    maxSnapshots: 20,
    maxAgeDays: 90,
    maxBytes: 1_000_000,
  });
  const first = await test.store.capture(capture("First"));
  const firstBytes = (
    await stat(join(test.directory, `${first.snapshotId}.json`))
  ).size;
  const maxBytes = firstBytes * 2 + 100;
  const bounded = createFileTaskRecoveryStore({
    ...test.input,
    retention: { maxSnapshots: 20, maxAgeDays: 90, maxBytes },
  });
  test.setTime("2026-10-28T09:00:00.000Z");
  await bounded.capture(capture("Second"));
  test.setTime("2026-10-28T10:00:00.000Z");
  const third = await bounded.capture(capture("Third"));
  const bytes = await Promise.all(
    (await readdir(test.directory)).map(
      async (name) => (await stat(join(test.directory, name))).size,
    ),
  );
  assert.ok(bytes.reduce((total, size) => total + size, 0) <= maxBytes);
  assert.ok((await test.store.list(target)).length <= 2);
  await assert.rejects(test.store.read(first.snapshotId), { code: "ENOENT" });
  await writeFile(join(test.directory, ".partial.tmp"), "x".repeat(maxBytes), {
    mode: 0o600,
  });
  await assert.rejects(bounded.capture(capture("Fourth")), /capacity/u);
  assert.equal(
    (await test.store.read(third.snapshotId)).snapshotId,
    third.snapshotId,
  );
  assert.equal(
    (await readFile(join(test.directory, ".partial.tmp"), "utf8")).length,
    maxBytes,
  );
});

it("pins snapshots across concurrent captures and releases callback pins on success and failure", async () => {
  const test = await fixture({
    maxSnapshots: 1,
    maxAgeDays: 1,
    maxBytes: 1_000_000,
  });
  const snapshot = await test.store.capture(capture());
  const value = await test.store.withSnapshot(
    snapshot.snapshotId,
    async (selected) => {
      assert.equal(selected.snapshotId, snapshot.snapshotId);
      test.setTime("2026-11-04T08:00:00.000Z");
      await assert.rejects(test.store.capture(capture("Blocked")), /capacity/u);
      await assert.rejects(test.store.read(snapshot.snapshotId), /expired/u);
      return "restored";
    },
  );
  assert.equal(value, "restored");
  test.setTime(initialTime);
  await assert.rejects(
    test.store.withSnapshot(snapshot.snapshotId, async () => {
      throw new Error("synthetic restore failure");
    }),
    /synthetic restore failure/u,
  );
  assert.equal(
    (await readdir(test.directory)).some((name) => name.startsWith(".pin-")),
    false,
  );
  test.setTime("2026-11-04T08:00:00.000Z");
  await test.store.capture(capture("After release"));
  await assert.rejects(test.store.read(snapshot.snapshotId), {
    code: "ENOENT",
  });
});

it("enforces snapshot age on access without another capture while preserving only existing pending references", async () => {
  const test = await fixture({
    maxSnapshots: 5,
    maxAgeDays: 1,
    maxBytes: 1_000_000,
  });
  const expired = await test.store.capture(capture("Unretained history"));
  const pending = await test.store.capture(
    capture("Pending operation evidence"),
  );
  await test.store.retain(pending.snapshotId, "pending-operation");
  const expiredPath = join(test.directory, `${expired.snapshotId}.json`);
  const historicalBytes = await readFile(expiredPath, "utf8");
  test.setTime("2026-10-30T08:00:00.000Z");
  const reopened = createFileTaskRecoveryStore(test.input);
  await assert.rejects(reopened.read(expired.snapshotId), /expired/u);
  assert.deepEqual(
    (await reopened.list(target)).map((snapshot) => snapshot.snapshotId),
    [pending.snapshotId],
  );
  let callbackRan = false;
  await assert.rejects(
    reopened.withSnapshot(expired.snapshotId, async () => {
      callbackRan = true;
    }),
    /expired/u,
  );
  assert.equal(callbackRan, false);
  await assert.rejects(
    reopened.retain(expired.snapshotId, "new-reference"),
    /expired/u,
  );
  await assert.rejects(
    reopened.retain(pending.snapshotId, "different-new-reference"),
    /expired/u,
  );
  assert.equal(
    (await reopened.read(pending.snapshotId)).snapshotId,
    pending.snapshotId,
  );
  assert.equal(
    await reopened.withSnapshot(
      pending.snapshotId,
      async (snapshot) => snapshot.snapshotId,
    ),
    pending.snapshotId,
  );
  await reopened.retain(pending.snapshotId, "pending-operation");
  await reopened.release(pending.snapshotId, "pending-operation");
  await assert.rejects(reopened.read(pending.snapshotId), /expired/u);
  await assert.rejects(
    reopened.withSnapshot(pending.snapshotId, async () => {
      callbackRan = true;
    }),
    /expired/u,
  );
  assert.deepEqual(await reopened.list(target), []);
  assert.equal(await readFile(expiredPath, "utf8"), historicalBytes);
  assert.equal(
    (await readdir(test.directory)).some(
      (name) => name.startsWith(".pin-") || name.startsWith(".retain-"),
    ),
    false,
  );
});

it("retains pending operation references durably and releases only the exact reference", async () => {
  const test = await fixture({
    maxSnapshots: 1,
    maxAgeDays: 1,
    maxBytes: 1_000_000,
  });
  const snapshot = await test.store.capture(capture());
  await test.store.retain(snapshot.snapshotId, "restore-operation-1");
  await test.store.retain(snapshot.snapshotId, "restore-operation-1");
  assert.equal(
    (await readdir(test.directory)).filter((name) =>
      name.startsWith(".retain-"),
    ).length,
    1,
  );
  const reopened = createFileTaskRecoveryStore(test.input);
  test.setTime("2026-11-04T08:00:00.000Z");
  await assert.rejects(
    reopened.capture(capture("Cannot prune pending evidence")),
    /capacity/u,
  );
  await reopened.release(snapshot.snapshotId, "different-operation");
  await assert.rejects(
    reopened.capture(capture("Still retained")),
    /capacity/u,
  );
  await reopened.release(snapshot.snapshotId, "restore-operation-1");
  await reopened.release(snapshot.snapshotId, "restore-operation-1");
  await reopened.capture(capture("Resolved"));
  await assert.rejects(reopened.read(snapshot.snapshotId), { code: "ENOENT" });
});

it("keeps a killed publisher's partial capture unavailable and a killed restore's pin protected", async () => {
  const test = await fixture({
    maxSnapshots: 1,
    maxAgeDays: 1,
    maxBytes: 1_000_000,
  });
  const moduleUrl = new URL(
    "../../src/tasks/file-task-recovery-store.js",
    import.meta.url,
  ).href;
  const input = {
    stateRoot: test.stateRoot,
    excludedRoots: [test.excluded],
    retention: test.input.retention,
  };
  const interrupted = await child(`
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.promises.rename;
    fs.promises.rename = async (...args) => { process.kill(process.pid, 'SIGKILL'); return original(...args); };
    syncBuiltinESMExports();
    const { createFileTaskRecoveryStore } = await import(${JSON.stringify(moduleUrl)});
    await createFileTaskRecoveryStore({ ...${JSON.stringify(input)}, now: () => ${JSON.stringify(initialTime)} }).capture(${JSON.stringify(capture())});
  `);
  assert.equal(interrupted.signal, "SIGKILL", interrupted.stderr);
  assert.deepEqual(await test.store.list(target), []);
  const temporary = (await readdir(test.directory)).filter((name) =>
    name.endsWith(".tmp"),
  );
  assert.equal(temporary.length, 1);
  await writeFile(
    join(test.directory, ".truncated.tmp"),
    Buffer.from([0xf0, 0x9f]),
    { mode: 0o600 },
  );
  assert.deepEqual(await test.store.list(target), []);
  await assert.rejects(test.store.read(randomUUID()), { code: "ENOENT" });
  await assert.rejects(test.store.capture(capture()), /capacity/u);
  for (const name of [...temporary, ".truncated.tmp"])
    await rm(join(test.directory, name));
  const snapshot = await test.store.capture(capture());
  const killedRestore = await child(`
    const { createFileTaskRecoveryStore } = await import(${JSON.stringify(moduleUrl)});
    await createFileTaskRecoveryStore({ ...${JSON.stringify(input)}, now: () => ${JSON.stringify(initialTime)} }).withSnapshot(${JSON.stringify(snapshot.snapshotId)}, async () => { process.kill(process.pid, 'SIGKILL'); });
  `);
  assert.equal(killedRestore.signal, "SIGKILL", killedRestore.stderr);
  assert.equal(
    (await readdir(test.directory)).some((name) => name.startsWith(".pin-")),
    true,
  );
  test.setTime("2026-11-04T08:00:00.000Z");
  await assert.rejects(
    test.store.capture(capture("Pinned after crash")),
    /capacity/u,
  );
  await assert.rejects(test.store.read(snapshot.snapshotId), /expired/u);
  assert.equal(
    (await stat(join(test.directory, `${snapshot.snapshotId}.json`))).isFile(),
    true,
  );
});

it("reconciles verified overlimit snapshots before another interrupted publication can accumulate", async () => {
  const test = await fixture({
    maxSnapshots: 3,
    maxAgeDays: 90,
    maxBytes: 1_000_000,
  });
  await test.store.capture(capture("First"));
  test.setTime("2026-10-28T09:00:00.000Z");
  await test.store.capture(capture("Second"));
  test.setTime("2026-10-28T10:00:00.000Z");
  const latest = await test.store.capture(capture("Third"));
  const moduleUrl = new URL(
    "../../src/tasks/file-task-recovery-store.js",
    import.meta.url,
  ).href;
  const input = {
    stateRoot: test.stateRoot,
    excludedRoots: [test.excluded],
    retention: { maxSnapshots: 1, maxAgeDays: 90, maxBytes: 1_000_000 },
  };
  const interrupted = await child(`
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    fs.promises.rename = async () => { process.kill(process.pid, 'SIGKILL'); };
    syncBuiltinESMExports();
    const { createFileTaskRecoveryStore } = await import(${JSON.stringify(moduleUrl)});
    await createFileTaskRecoveryStore(${JSON.stringify(input)}).capture(${JSON.stringify(capture("Interrupted fourth"))});
  `);
  assert.equal(interrupted.signal, "SIGKILL", interrupted.stderr);
  const files = await readdir(test.directory);
  assert.deepEqual(
    files.filter((name) => !name.startsWith(".")),
    [`${latest.snapshotId}.json`],
  );
  assert.equal(files.filter((name) => name.endsWith(".tmp")).length, 1);
  const bounded = createFileTaskRecoveryStore(input);
  await assert.rejects(
    bounded.capture(capture("Repeated attempt")),
    /capacity/u,
  );
  assert.deepEqual(await readdir(test.directory), files);
});

it("preserves verified native timing and lifecycle mappings without inventing unavailable timing", async () => {
  const test = await fixture();
  const nativeTiming: NativeTaskTimingObservation = {
    schemaVersion: 1,
    status: "observed",
    observedAt: initialTime,
    timeZone: "UTC",
    horizon: { start: "2026-10-28T00:00:00Z", end: "2026-10-29T00:00:00Z" },
    complete: { tasks: true, busy: true, meals: true, protected: true },
    tasks: [
      {
        identity: {
          canonical: { listId: "synthetic-list", taskId: "task-1" },
          aliases: [],
        },
        timing: { start: "2026-10-28T09:00:00Z", end: "2026-10-28T09:30:00Z" },
        ownership: { kind: "manual" },
        evidence: {
          surface: "native-task-editor",
          verifiedAt: initialTime,
          reference: "synthetic-observation",
        },
      },
    ],
    protectedIntervals: [],
  };
  const lifecycle = {
    schemaVersion: 1 as const,
    revision: 1,
    entries: [
      {
        target: { kind: target.kind, key: target.key },
        occurrenceId: "source:1",
        source: { kind: "synthetic", id: "source" },
        disposition: "active" as const,
        recordedAt: initialTime,
        evidenceRef: "synthetic-owner",
        providers: [
          {
            canonical: { listId: "synthetic-list", taskId: "task-1" },
            aliases: [],
          },
        ],
      },
    ],
  };
  const lifecycleEntry = lifecycle.entries[0];
  assert.ok(lifecycleEntry);
  const snapshot = await test.store.capture({
    ...capture(),
    nativeTiming,
    lifecycle,
  });
  const reopened = await createFileTaskRecoveryStore(test.input).read(
    snapshot.snapshotId,
  );
  assert.deepEqual(reopened.nativeTiming, nativeTiming);
  assert.deepEqual(reopened.lifecycle, lifecycle);
  assert.equal(reopened.coverage.nativeTiming, "observed");
  await assert.rejects(
    test.store.capture({
      ...capture(),
      nativeTiming: {
        ...nativeTiming,
        status: "unknown",
      } as unknown as NativeTaskTimingObservation,
    }),
  );
  await assert.rejects(
    test.store.capture({
      ...capture(),
      nativeTiming: {
        ...nativeTiming,
        complete: { ...nativeTiming.complete, busy: false },
      } as unknown as NativeTaskTimingObservation,
    }),
  );
  await assert.rejects(
    test.store.capture({
      ...capture(),
      lifecycle: {
        ...lifecycle,
        entries: [
          { ...lifecycleEntry, target: { ...target, key: "unrelated" } },
        ],
      },
    }),
    /different target/u,
  );
  assert.equal((await test.store.list(target)).length, 1);
});

async function child(
  script: string,
): Promise<{ code: number | null; signal: string | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      globalThis.process.execPath,
      ["--input-type=module", "-e", script],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    process.stderr.on("data", (bytes) => {
      stderr += String(bytes);
    });
    process.on("error", reject);
    process.on("close", (code, signal) => resolve({ code, signal, stderr }));
  });
}
