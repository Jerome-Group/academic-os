import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { taskExecutionSnapshot } from "../../src/tasks/task-execution-plan.js";
import { runCliWithEnvironment } from "../support/run-cli.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-recovery-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const driveMount = join(root, "Drive"),
    stateRoot = join(root, "State");
  const admin = join(driveMount, "Semester/MH2100/00 Module Admin");
  await mkdir(admin, { recursive: true });
  await mkdir(stateRoot, { mode: 0o700 });
  const registerPath = join(admin, "30 Task Register.yaml");
  await writeFile(registerPath, "list_id: fixture-list\ntasks: []\n");
  const configPath = join(root, "config.json"),
    providerPath = join(root, "provider.json");
  await writeFile(
    configPath,
    JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Semester", status: "active", modules: ["MH2100"] },
      },
      tasks: {
        credentials: {
          scheduledRead: join(root, "read.json"),
          interactiveWrite: join(root, "write.json"),
        },
      },
    }),
  );
  const original = [
    { id: "old-open", title: "Historical work", status: "needsAction" },
    {
      id: "old-done",
      title: "Finished work",
      status: "completed",
      completed: "2026-10-01T01:00:00Z",
    },
  ];
  await writeFile(
    providerPath,
    JSON.stringify({
      lists: [{ id: "fixture-list", title: "MH2100" }],
      tasks: { "fixture-list": original },
    }),
  );
  const run = (...args: string[]) =>
    runCliWithEnvironment(
      {
        ACADEMIC_OS_FAKE_TASKS_STATE: providerPath,
        NODE_OPTIONS: `--import=${new URL("../support/fake-tasks-preload.js", import.meta.url).href}`,
      },
      "tasks",
      ...args,
      "--config",
      configPath,
      "--json",
    );
  const state = async () => JSON.parse(await readFile(providerPath, "utf8"));
  const history = async () => {
    const r = await run("recovery", "--target", "Y2S1/MH2100");
    assert.equal(r.exitCode, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
  return {
    root,
    stateRoot,
    registerPath,
    providerPath,
    configPath,
    original,
    run,
    state,
    history,
  };
}

test("compiled recovery captures pre-edit history, survives source deletion and recreates exactly once with new IDs and completion state", async (t) => {
  const f = await fixture(t);
  const refresh = await f.run("refresh");
  assert.equal(refresh.exitCode, 0, refresh.stdout + refresh.stderr);
  const initial = await f.history();
  const snapshotId = initial.targets[0].snapshots[0].snapshotId;
  const changePath = join(f.root, "change.json");
  await writeFile(
    changePath,
    JSON.stringify({
      schemaVersion: 1,
      operationId: "fixture-change",
      target: { kind: "module", key: "Y2S1/MH2100", title: "MH2100" },
      listId: "fixture-list",
      expectedSnapshot: taskExecutionSnapshot(f.original as never),
      operation: {
        name: "change",
        taskId: "old-open",
        title: "Manual new title",
      },
      policyVersion: "fixture-policy",
    }),
  );
  const change = await f.run("apply-plan", "--plan", changePath);
  assert.equal(change.exitCode, 0, change.stdout + change.stderr);
  const versions = await f.history();
  const before = versions.targets[0].snapshots.find(
    (s: { operation?: { operationId: string }; reason: string }) =>
      s.reason === "before-operation" &&
      s.operation?.operationId === "fixture-change",
  );
  assert.ok(before);
  const selected = await f.run(
    "recovery",
    "--target",
    "Y2S1/MH2100",
    "--snapshot",
    before.snapshotId,
  );
  assert.equal(selected.exitCode, 0);
  assert.equal(
    JSON.parse(selected.stdout).targets[0].snapshot.live.find(
      (s: { id: string }) => s.id === "old-open",
    ).title,
    "Historical work",
  );
  const state = await f.state();
  state.tasks["fixture-list"] = [];
  await writeFile(f.providerPath, JSON.stringify(state));
  const pull = await f.run("refresh");
  assert.equal(pull.exitCode, 0, pull.stdout + pull.stderr);
  const target = { kind: "module", key: "Y2S1/MH2100", title: "MH2100" };
  for (const [id, completed] of [
    ["old-open", false],
    ["old-done", true],
  ] as const) {
    const current = await f.state(),
      h = await f.history();
    const plan = {
      schemaVersion: "task-restore/1",
      operationId: `fixture-restore-${id}`,
      target,
      listId: "fixture-list",
      snapshotId,
      originalTaskId: id,
      sourceOccurrenceId: `provider:${JSON.stringify(["fixture-list", id])}`,
      expectedSnapshot: taskExecutionSnapshot(current.tasks["fixture-list"]),
      expectedLifecycleRevision: h.expectedLifecycleRevision,
      policyVersion: "fixture-policy",
      ownerApprovalRef: "synthetic exact approval",
      scheduling: { mode: "api-fields-only", acknowledgeTimingLoss: true },
    };
    const path = join(f.root, `restore-${id}.json`);
    await writeFile(path, JSON.stringify(plan));
    const writesBefore = current.requests.filter(
      (r: { method: string }) => r.method !== "GET",
    ).length;
    const preview = await f.run("restore", "--plan", path);
    assert.equal(preview.exitCode, 0, preview.stdout + preview.stderr);
    assert.equal(JSON.parse(preview.stdout).outcome, "preview");
    assert.equal(
      (await f.state()).requests.filter(
        (r: { method: string }) => r.method !== "GET",
      ).length,
      writesBefore,
    );
    const apply = await f.run("restore", "--plan", path, "--apply");
    assert.equal(apply.exitCode, 0, apply.stdout + apply.stderr);
    const result = JSON.parse(apply.stdout);
    assert.equal(result.outcome, "applied");
    assert.notEqual(result.newTaskId, id);
    assert.equal(result.nativeTimingRestored, false);
    const repeat = await f.run("restore", "--plan", path, "--apply");
    assert.equal(repeat.exitCode, 0, repeat.stdout + repeat.stderr);
    assert.equal(JSON.parse(repeat.stdout).newTaskId, result.newTaskId);
    const after = await f.state();
    assert.equal(
      after.tasks["fixture-list"].filter(
        (r: { id: string }) => r.id === result.newTaskId,
      ).length,
      1,
    );
    assert.equal(
      after.tasks["fixture-list"].find(
        (r: { id: string }) => r.id === result.newTaskId,
      ).status,
      completed ? "completed" : "needsAction",
    );
    assert.equal(
      after.requests.filter((r: { method: string }) => r.method === "POST")
        .length,
      completed ? 2 : 1,
    );
  }
  const register = await readFile(f.registerPath, "utf8");
  assert.match(register, /old-open/);
  assert.match(register, /old-done/);
  assert.match(register, /cancelled/);
  assert.match(register, /completed/);
});

test("compiled configured write fails before sending when its independent recovery capture is unsafe", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.stateRoot, "task-recovery"), { mode: 0o755 });
  const path = join(f.root, "create.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      operationId: "blocked-create",
      target: { kind: "module", key: "Y2S1/MH2100", title: "MH2100" },
      listId: "fixture-list",
      expectedSnapshot: taskExecutionSnapshot(f.original as never),
      operation: { name: "create", title: "Must remain unsent" },
      sourceOccurrenceId: "fixture-new",
      policyVersion: "fixture-policy",
    }),
  );
  const r = await f.run("apply-plan", "--plan", path);
  assert.equal(r.exitCode, 2);
  assert.notEqual(JSON.parse(r.stdout).outcome, "applied");
  assert.equal(
    (await f.state()).requests.filter(
      (r: { method: string }) => r.method !== "GET",
    ).length,
    0,
  );
  const refresh = await f.run("refresh");
  assert.equal(refresh.exitCode, 2);
  assert.match(await readFile(f.registerPath, "utf8"), /tasks: \[\]/);
});

test("an unknown restore outcome blocks ordinary exact-plan creation of the same source occurrence", async (t) => {
  const f = await fixture(t);
  const refreshed = await f.run("refresh");
  assert.equal(refreshed.exitCode, 0);
  const h = await f.history(),
    snapshotId = h.targets[0].snapshots[0].snapshotId;
  const provider = await f.state();
  provider.tasks["fixture-list"] = [];
  provider.taskCreateIdsMissing = true;
  await writeFile(f.providerPath, JSON.stringify(provider));
  const occurrence = `provider:${JSON.stringify(["fixture-list", "old-open"])}`;
  const path = join(f.root, "uncertain-restore.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: "task-restore/1",
      operationId: "fixture-unknown-restore",
      target: { kind: "module", key: "Y2S1/MH2100", title: "MH2100" },
      listId: "fixture-list",
      snapshotId,
      originalTaskId: "old-open",
      sourceOccurrenceId: occurrence,
      expectedSnapshot: taskExecutionSnapshot([]),
      expectedLifecycleRevision: h.expectedLifecycleRevision,
      policyVersion: "fixture",
      ownerApprovalRef: "synthetic exact approval",
      scheduling: { mode: "api-fields-only", acknowledgeTimingLoss: true },
    }),
  );
  const restored = await f.run("restore", "--plan", path, "--apply");
  assert.equal(restored.exitCode, 2);
  assert.equal(JSON.parse(restored.stdout).outcome, "uncertain");
  const after = await f.state();
  const createPath = join(f.root, "ordinary-create.json");
  await writeFile(
    createPath,
    JSON.stringify({
      schemaVersion: 1,
      operationId: "fixture-duplicate-create",
      target: { kind: "module", key: "Y2S1/MH2100", title: "MH2100" },
      listId: "fixture-list",
      expectedSnapshot: taskExecutionSnapshot(after.tasks["fixture-list"]),
      operation: {
        name: "create",
        title: "Another title cannot evade source identity",
      },
      sourceOccurrenceId: occurrence,
      policyVersion: "fixture",
    }),
  );
  const duplicate = await f.run("apply-plan", "--plan", createPath);
  assert.equal(duplicate.exitCode, 2);
  assert.equal(JSON.parse(duplicate.stdout).code, "source-occurrence-reserved");
  assert.equal(
    (await f.state()).requests.filter(
      (r: { method: string }) => r.method === "POST",
    ).length,
    1,
  );
});

test("configured restore retains the known new ID when lifecycle owner drainage fails and resumes without another create", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run("refresh")).exitCode, 0);
  const history = await f.history();
  const provider = await f.state();
  provider.tasks["fixture-list"] = [];
  await writeFile(f.providerPath, JSON.stringify(provider));
  const planPath = join(f.root, "owner-failure-plan.json");
  await writeFile(
    planPath,
    JSON.stringify({
      schemaVersion: "task-restore/1",
      operationId: "fixture-owner-failure",
      target: { kind: "module", key: "Y2S1/MH2100", title: "MH2100" },
      listId: "fixture-list",
      snapshotId: history.targets[0].snapshots[0].snapshotId,
      originalTaskId: "old-open",
      sourceOccurrenceId: `provider:${JSON.stringify(["fixture-list", "old-open"])}`,
      expectedSnapshot: taskExecutionSnapshot([]),
      expectedLifecycleRevision: history.expectedLifecycleRevision,
      policyVersion: "fixture",
      ownerApprovalRef: "synthetic exact approval",
      scheduling: { mode: "api-fields-only", acknowledgeTimingLoss: true },
    }),
  );
  const faultPath = join(f.root, "lifecycle-fault.mjs");
  await writeFile(
    faultPath,
    `import fs from "node:fs/promises";import {syncBuiltinESMExports} from "node:module";const original=fs.rename;fs.rename=async(from,to)=>{if(String(to).endsWith("/task-lifecycle.json"))throw new Error("synthetic lifecycle rename failure");return original(from,to);};syncBuiltinESMExports();`,
  );
  const result = await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_TASKS_STATE: f.providerPath,
      ACADEMIC_OS_FAILURE_LIFECYCLE_PATH: join(
        f.stateRoot,
        "task-lifecycle.json",
      ),
      NODE_OPTIONS: `--import=${new URL("../support/fake-tasks-preload.js", import.meta.url).href} --import=${pathToFileURL(faultPath).href}`,
    },
    "tasks",
    "restore",
    "--config",
    f.configPath,
    "--plan",
    planPath,
    "--apply",
    "--json",
  );
  assert.equal(result.exitCode, 2, result.stdout + result.stderr);
  const uncertain = JSON.parse(result.stdout);
  assert.equal(uncertain.outcome, "uncertain");
  assert.equal(uncertain.code, "lifecycle-owner-failed");
  assert.equal(uncertain.newTaskId, "created-1");
  const resumed = await f.run("restore", "--plan", planPath, "--apply");
  assert.equal(resumed.exitCode, 0, resumed.stdout + resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).newTaskId, "created-1");
  assert.equal(
    (await f.state()).requests.filter(
      (r: { method: string }) => r.method === "POST",
    ).length,
    1,
  );
});

test("configured cancellation retains a pre-delete provider version and refuses resurrection of its owner dismissal", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run("refresh")).exitCode, 0);
  const path = join(f.root, "cancel.json");
  const target = { kind: "module", key: "Y2S1/MH2100", title: "MH2100" };
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      operationId: "fixture-cancel",
      target,
      listId: "fixture-list",
      expectedSnapshot: taskExecutionSnapshot(f.original as never),
      operation: { name: "cancel", taskId: "old-open" },
      policyVersion: "fixture",
    }),
  );
  const cancelled = await f.run("apply-plan", "--plan", path);
  assert.equal(cancelled.exitCode, 0, cancelled.stdout + cancelled.stderr);
  const history = await f.history();
  const before = history.targets[0].snapshots.find(
    (s: { reason: string; operation?: { operationId: string } }) =>
      s.reason === "before-operation" &&
      s.operation?.operationId === "fixture-cancel",
  );
  assert.ok(before);
  const detail = await f.run(
    "recovery",
    "--target",
    target.key,
    "--snapshot",
    before.snapshotId,
  );
  assert.equal(detail.exitCode, 0);
  const old = JSON.parse(detail.stdout).targets[0].snapshot.live.find(
    (r: { id: string }) => r.id === "old-open",
  );
  assert.equal(old.title, "Historical work");
  assert.equal(old.deleted, undefined);
  const current = await f.state();
  const restorePath = join(f.root, "cancel-restore.json");
  await writeFile(
    restorePath,
    JSON.stringify({
      schemaVersion: "task-restore/1",
      operationId: "fixture-cancel-restore",
      target,
      listId: "fixture-list",
      snapshotId: before.snapshotId,
      originalTaskId: "old-open",
      sourceOccurrenceId: `provider:${JSON.stringify(["fixture-list", "old-open"])}`,
      expectedSnapshot: taskExecutionSnapshot(current.tasks["fixture-list"]),
      expectedLifecycleRevision: history.expectedLifecycleRevision,
      policyVersion: "fixture",
      ownerApprovalRef: "synthetic approval cannot reopen dismissal",
      scheduling: { mode: "api-fields-only", acknowledgeTimingLoss: true },
    }),
  );
  const refused = await f.run("restore", "--plan", restorePath, "--apply");
  assert.equal(refused.exitCode, 2);
  assert.equal(JSON.parse(refused.stdout).code, "owner-dismissed");
  assert.equal(
    (await f.state()).requests.filter(
      (r: { method: string }) => r.method === "POST",
    ).length,
    0,
  );
});
