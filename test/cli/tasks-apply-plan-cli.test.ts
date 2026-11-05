import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findTaskCreationSource } from "../../src/tasks/task-operation-journal-file.js";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { taskExecutionSnapshot } from "../../src/tasks/task-execution-plan.js";
import { runCliWithEnvironment } from "../support/run-cli.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const preload = new URL("../support/fake-tasks-preload.js", import.meta.url)
  .href;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "academic-os-exact-plan-"));
  roots.push(root);
  const driveMount = join(root, "Drive"),
    stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Semester", "MH2100");
  await mkdir(join(moduleRoot, "00 Module Admin"), { recursive: true });
  await mkdir(stateRoot, { mode: 0o700 });
  const registerPath = join(
    moduleRoot,
    "00 Module Admin",
    "30 Task Register.yaml",
  );
  await writeFile(registerPath, "list_id: fixture-list\ntasks: []\n");
  const configPath = join(root, "config.json");
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
          scheduledRead: join(root, "read-fixture.json"),
          interactiveWrite: join(root, "write-fixture.json"),
        },
      },
    }),
  );
  const providerPath = join(root, "provider.json"),
    planPath = join(root, "plan.json");
  await writeFile(
    providerPath,
    JSON.stringify({
      lists: [{ id: "fixture-list", title: "MH2100" }],
      tasks: { "fixture-list": [] },
    }),
  );
  const plan = {
    schemaVersion: 1,
    operationId: "fixture-operation",
    target: { kind: "module", key: "Y2S1/MH2100", title: "MH2100" },
    listId: "fixture-list",
    expectedSnapshot: taskExecutionSnapshot([]),
    operation: {
      name: "create",
      title: "Fixture work",
      provenance: { source: "fixture-source" },
    },
    sourceOccurrenceId: "fixture-occurrence",
    policyVersion: "fixture-policy-1",
  };
  await writeFile(planPath, JSON.stringify(plan));
  const run = (...args: string[]) =>
    runCliWithEnvironment(
      {
        ACADEMIC_OS_FAKE_TASKS_STATE: providerPath,
        NODE_OPTIONS: `--import=${preload}`,
      },
      "tasks",
      ...args,
      "--config",
      configPath,
      "--json",
    );
  return {
    root,
    stateRoot,
    configPath,
    registerPath,
    providerPath,
    planPath,
    plan,
    run,
  };
}

test("compiled exact-plan CLI persists identity/provenance, refreshes its receipt and replays without duplicate effects", async () => {
  const f = await fixture();
  const first = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(first.exitCode, 0, first.stdout + first.stderr);
  assert.equal(JSON.parse(first.stdout).outcome, "applied");
  const repeat = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(repeat.exitCode, 0, repeat.stdout + repeat.stderr);
  const provider = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.equal(provider.tasks["fixture-list"].length, 1);
  assert.equal(
    provider.requests.filter((r: { method: string }) => r.method === "POST")
      .length,
    1,
  );
  const register = await readFile(f.registerPath, "utf8");
  assert.match(register, /task_id: created-1/u);
  assert.match(register, /source: fixture-source/u);
  assert.doesNotMatch(register, /notes:/u);
  const status = await f.run("status");
  assert.equal(status.exitCode, 0, status.stdout + status.stderr);
  const receipt = JSON.parse(status.stdout).targets[0].receipt;
  assert.equal(receipt.freshness, "fresh");
  assert.match(receipt.generation, /^[a-f0-9]{64}$/u);
  const providerAfterStatus = JSON.parse(
    await readFile(f.providerPath, "utf8"),
  );
  assert.deepEqual(providerAfterStatus.requests, provider.requests);
});

test("compiled plan refuses changed owner state and descriptions with zero provider writes", async () => {
  const f = await fixture();
  await writeFile(
    f.providerPath,
    JSON.stringify({
      lists: [],
      tasks: {
        "fixture-list": [
          { id: "owner-task", title: "Owner edit", status: "needsAction" },
        ],
      },
    }),
  );
  const changed = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(changed.exitCode, 2);
  assert.equal(JSON.parse(changed.stdout).outcome, "conflict");
  const provider = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.equal(
    provider.requests.filter((r: { method: string }) => r.method !== "GET")
      .length,
    0,
  );
  await writeFile(
    f.planPath,
    JSON.stringify({
      ...f.plan,
      operation: { ...f.plan.operation, notes: "Forbidden description" },
    }),
  );
  const described = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(described.exitCode, 2);
  const after = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.deepEqual(after.requests, provider.requests);
});

test("timed or date placement fails closed until the separate native adapter is verified", async () => {
  const f = await fixture();
  await writeFile(
    f.planPath,
    JSON.stringify({
      ...f.plan,
      operation: { ...f.plan.operation, doDate: "2026-10-29" },
    }),
  );
  const result = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(result.exitCode, 2, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).code, "native-timing-unavailable");
  const provider = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.equal(
    (provider.requests ?? []).filter(
      (r: { method: string }) => r.method !== "GET",
    ).length,
    0,
  );
});

test("unobserved status is read-only and creates no receipt, journal or lifecycle files", async () => {
  const f = await fixture();
  const before = await readdir(f.stateRoot);
  const result = await f.run("status");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).targets[0].outcome, "unobserved");
  assert.deepEqual(await readdir(f.stateRoot), before);
  assert.deepEqual(
    JSON.parse(await readFile(f.providerPath, "utf8")).requests,
    undefined,
  );
});

test("explicit owner dismissal blocks replacement creation without mutating the provider", async () => {
  const f = await fixture();
  const decisionPath = join(f.root, "owner-decision.json");
  await writeFile(
    decisionPath,
    JSON.stringify({
      target: { kind: "module", key: "Y2S1/MH2100" },
      occurrenceId: "fixture-occurrence",
      source: { kind: "source-occurrence", id: "fixture-occurrence" },
      disposition: "owner-dismissed",
      recordedAt: "2026-10-27T00:00:00.000Z",
      evidenceRef: "fixture-owner-decision",
      providers: [],
    }),
  );
  const recorded = await f.run("record-lifecycle", "--decision", decisionPath);
  assert.equal(recorded.exitCode, 0, recorded.stdout + recorded.stderr);
  const before = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.deepEqual(before.requests, undefined);
  const result = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(result.exitCode, 2, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).code, "owner-dismissed");
  const provider = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.equal(
    (provider.requests ?? []).filter(
      (r: { method: string }) => r.method !== "GET",
    ).length,
    0,
  );
});

test("configured lifecycle recording failure preserves known remote identity and recovers without resending", async () => {
  const f = await fixture();
  const lifecyclePath = join(f.stateRoot, "task-lifecycle.json");
  const provider = JSON.parse(await readFile(f.providerPath, "utf8"));
  provider.taskAfterCreateCorruptFile = lifecyclePath;
  await writeFile(f.providerPath, JSON.stringify(provider));
  const first = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(first.exitCode, 2, first.stdout + first.stderr);
  const uncertain = JSON.parse(first.stdout);
  assert.equal(uncertain.outcome, "uncertain");
  assert.equal(uncertain.taskId, "created-1");
  assert.equal(uncertain.code, "local-recording-unverified");
  const accepted = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.equal(
    accepted.requests.filter(
      (request: { method: string }) => request.method === "POST",
    ).length,
    1,
  );
  // This exact synthetic corrupt file is owned by the fixture; repair represents explicit reconciliation.
  await rm(lifecyclePath);
  delete accepted.taskAfterCreateCorruptFile;
  await writeFile(f.providerPath, JSON.stringify(accepted));
  const recovered = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(recovered.exitCode, 0, recovered.stdout + recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).taskId, "created-1");
  const final = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.equal(
    final.requests.filter(
      (request: { method: string }) => request.method === "POST",
    ).length,
    1,
  );
  assert.match(
    await readFile(f.registerPath, "utf8"),
    /source: fixture-source/u,
  );
});

test("known-ID create recovery retains its source when another client completes the task first", async () => {
  const f = await fixture();
  const provider = JSON.parse(await readFile(f.providerPath, "utf8"));
  provider.taskReadbackFailures = ["fixture-list"];
  await writeFile(f.providerPath, JSON.stringify(provider));
  const first = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(JSON.parse(first.stdout).outcome, "uncertain", first.stdout);
  assert.equal(JSON.parse(first.stdout).taskId, "created-1");
  const refreshed = await f.run("refresh");
  assert.equal(refreshed.exitCode, 0, refreshed.stdout);
  const current = JSON.parse(await readFile(f.providerPath, "utf8"));
  delete current.taskReadbackFailures;
  await writeFile(f.providerPath, JSON.stringify(current));
  // A separate native client completes the exact provider ID and records its terminal source
  // receipt. This proves original-create recovery, independent of the completion producer.
  const native = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      preload,
      "--input-type=module",
      "--eval",
      `
      import { createGoogleTaskOperationWriter } from ${JSON.stringify(new URL("../../src/tasks/google-tasks-client.js", import.meta.url).href)};
      const writer = createGoogleTaskOperationWriter(process.argv[1]);
      await writer.patchTask({listId:"fixture-list",taskId:"created-1",patch:{status:"completed"}});
      process.stdout.write(JSON.stringify(await writer.readTask({listId:"fixture-list",taskId:"created-1"})));`,
      join(f.root, "write-fixture.json"),
    ],
    {
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        ACADEMIC_OS_FAKE_TASKS_STATE: f.providerPath,
      },
    },
  );
  assert.equal(JSON.parse(native.stdout).status, "completed");
  const source = await findTaskCreationSource(f.stateRoot, {
    target: { kind: "module", key: f.plan.target.key },
    listId: f.plan.listId,
    taskId: "created-1",
  });
  assert.equal(source?.sourceOccurrenceId, "fixture-occurrence");
  const decisionPath = join(f.root, "native-completion-receipt.json");
  await writeFile(
    decisionPath,
    JSON.stringify({
      target: { kind: f.plan.target.kind, key: f.plan.target.key },
      occurrenceId: source?.sourceOccurrenceId,
      source: { kind: "source-occurrence", id: source?.sourceOccurrenceId },
      disposition: "completed",
      recordedAt: new Date().toISOString(),
      evidenceRef: "fixture-external-native-same-id-readback",
      providers: [
        {
          canonical: { listId: "fixture-list", taskId: "created-1" },
          aliases: [],
        },
      ],
    }),
  );
  const completed = await f.run("record-lifecycle", "--decision", decisionPath);
  assert.equal(completed.exitCode, 0, completed.stdout + completed.stderr);
  const recovered = await f.run("apply-plan", "--plan", f.planPath);
  assert.equal(recovered.exitCode, 0, recovered.stdout + recovered.stderr);
  const state = JSON.parse(
    await readFile(join(f.stateRoot, "task-lifecycle.json"), "utf8"),
  );
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].occurrenceId, "fixture-occurrence");
  assert.equal(state.entries[0].disposition, "completed");
  assert.match(
    await readFile(f.registerPath, "utf8"),
    /source: fixture-source/u,
  );
  const final = JSON.parse(await readFile(f.providerPath, "utf8"));
  assert.equal(
    final.requests.filter(
      (request: { method: string }) => request.method === "POST",
    ).length,
    1,
  );
  assert.equal(
    final.requests.filter(
      (request: { method: string }) => request.method === "PATCH",
    ).length,
    1,
  );
});
