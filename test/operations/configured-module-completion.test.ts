import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

import { sha256, sha256Bytes } from "../../src/checksum.js";
import { taskRegisterPath } from "../../src/contract/task-register.js";
import { emmyPlanningTestSources } from "../support/emmy-planning-source.js";
import { createEmmyPlanningProcess } from "../../src/operations/emmy-planning-process.js";
import { isJsonObject } from "../../src/operations/json-object.js";
import { configuredTaskRecoveryStore } from "../../src/tasks/configured-task-recovery.js";
import { createFilePreparedCompletionStore } from "../../src/tasks/file-prepared-completion-store.js";
import { createPrivateCompletionCatalogStore } from "../../src/tasks/private-completion-catalog-store.js";
import {
  parseTaskExecutionPlan,
  taskExecutionPlanDigest,
} from "../../src/tasks/task-execution-plan.js";

const execute = promisify(execFile);
const target = { kind: "module", key: "Y2S1/MH3210", title: "MH3210" } as const;
const originalId = "task-one";
const decoyId = "same-title-decoy";
const title = "Original source title";
const selector = {
  semester: "Y2S1",
  module: target.title,
  task_id: originalId,
};

async function fixture(t: TestContext, ignored = false) {
  const { releasePath, fixturesPath, sourceCommit, manifestSha256 } =
    await emmyPlanningTestSources();
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aos-completion-e2e-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const privateRoot = join(root, "Planning");
  const moduleRoot = join(driveMount, "Semester", target.title);
  await mkdir(join(moduleRoot, "00 Module Admin"), { recursive: true });
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(privateRoot, { mode: 0o700 });
  const registerPath = join(moduleRoot, taskRegisterPath);
  await writeFile(registerPath, "list_id: list-one\ntasks: []\n");
  const planning = {
    releaseRoot: await realpath(releasePath),
    privateRoot,
    catalogSourcePath: join(privateRoot, "configured-source.json"),
    manifestSha256,
    sourceCommit,
    environment: "synthetic",
    accountId: "owner@example.test",
    sourceIdentity: "synthetic-source-file",
  };
  const configPath = join(root, "config.json");
  const writeCredential = join(root, "synthetic-write.json");
  const config = {
    driveMount,
    stateRoot,
    activeSemester: "Y2S1",
    semesters: {
      Y2S1: { root: "Semester", status: "active", modules: [target.title] },
    },
    tasks: {
      planning,
      credentials: {
        scheduledRead: join(root, "synthetic-read.json"),
        interactiveWrite: writeCredential,
      },
    },
  };
  await writeFile(configPath, JSON.stringify(config));
  const providerPath = join(root, "provider.json");
  await writeFile(
    providerPath,
    JSON.stringify({
      lists: [{ id: "list-one", title: target.title }],
      tasks: {
        "list-one": [
          { id: decoyId, title, status: "needsAction" },
          { id: originalId, title, status: "needsAction" },
        ],
      },
      taskReadbackFailures: [originalId],
      ...(ignored ? { taskWritesIgnored: [originalId] } : {}),
    }),
  );
  const producer = createEmmyPlanningProcess(planning);
  const fixtureModule: unknown = await import(
    pathToFileURL(
      join(fixturesPath, "verification/academic-os-planning-fixtures.mjs"),
    ).href
  );
  const fixtureFactory = object(fixtureModule).academicOsPlanningFixture;
  assert.equal(typeof fixtureFactory, "function");
  if (typeof fixtureFactory !== "function")
    throw new Error("Missing fixture factory");
  const producerFixture = object(fixtureFactory());
  const catalogInput = object(producerFixture.catalogInput);
  const catalogStore = createPrivateCompletionCatalogStore({
    stateRoot: privateRoot,
    excludedRoots: [driveMount],
  });
  const preparedStore = createFilePreparedCompletionStore({
    stateRoot: privateRoot,
    excludedRoots: [driveMount],
  });
  const publish = async (input: unknown = catalogInput) => {
    const generated = await producer.run({
      schemaVersion: 1,
      stage: "publish",
      catalog: input,
    });
    assert.equal(generated.kind, "reported");
    if (generated.kind !== "reported")
      throw new Error("Producer refused fixture catalog");
    assert.equal(generated.data.status, "planning-catalog-ready");
    const catalog = generated.data.catalog;
    const owned = await catalogStore.withOwner((owner) =>
      owner.publish(
        {
          rawJson: Buffer.from(JSON.stringify(catalog)),
          sourceIdentity: planning.sourceIdentity,
          acquisitionJson: Buffer.from(
            JSON.stringify({
              synthetic: true,
              retainedCloudSource: "test-only",
            }),
          ),
        },
        async (candidate) => {
          const validated = await producer.run({
            schemaVersion: 1,
            stage: "validate",
            catalog: JSON.parse(candidate.rawJson.toString("utf8")),
          });
          assert.equal(validated.kind, "reported");
        },
      ),
    );
    assert.equal(owned.kind, "owned");
    return catalog;
  };
  const call = async (
    name: string,
    arguments_: Record<string, string> = selector,
  ) => {
    const request = {
      jsonrpc: "2.0",
      id: "module-caller",
      method: "tools/call",
      params: { name, arguments: arguments_ },
    };
    const { stdout, stderr } = await execute(
      process.execPath,
      [
        "--import",
        new URL("../support/fake-tasks-preload.js", import.meta.url).href,
        "--input-type=module",
        "--eval",
        `
        import { createConfiguredOperationsTools, OPERATIONS_SERVER_INFO } from ${JSON.stringify(new URL("../../src/operations/run-operations-server.js", import.meta.url).href)};
        import { createMcpDispatcher } from ${JSON.stringify(new URL("../../src/operations/dispatch-mcp-message.js", import.meta.url).href)};
        const tools = await createConfiguredOperationsTools(process.argv[1]);
        const dispatch = createMcpDispatcher({tools,serverInfo:OPERATIONS_SERVER_INFO});
        process.stdout.write(JSON.stringify(await dispatch(JSON.parse(process.argv[2]))));`,
        configPath,
        JSON.stringify(request),
      ],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          ACADEMIC_OS_FAKE_TASKS_STATE: providerPath,
        },
        timeout: 30_000,
      },
    );
    assert.equal(stderr, "");
    const response = object(JSON.parse(stdout));
    assert.equal(response.error, undefined);
    const result = object(response.result);
    const [content] = objects(result.content);
    assert.ok(content);
    return {
      isError: result.isError,
      report: object(JSON.parse(String(content.text))),
    };
  };
  const provider = async () =>
    object(JSON.parse(await readFile(providerPath, "utf8")));
  const saveProvider = (state: Record<string, unknown>) =>
    writeFile(providerPath, JSON.stringify(state));
  const prepare = async () => {
    const discovered = await call("tasks_discover_completion");
    assert.equal(discovered.isError, false, JSON.stringify(discovered));
    const result = await call("tasks_prepare_completion");
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.report.status, "prepared");
    const packet = object(result.report.prepared);
    const callResult = object(result.report.call);
    assert.equal(callResult.tool, "tasks_apply_plan");
    const planJson = String(object(callResult.arguments).plan_json);
    const plan = parseTaskExecutionPlan(JSON.parse(planJson));
    const retained = await preparedStore.read(plan.operationId);
    assert.ok(retained?.acquisitionEvidenceJson);
    assert.deepEqual(JSON.parse(retained.packetJson), packet);
    assert.deepEqual(retained.plan, plan);
    assert.equal(retained.planDigest, taskExecutionPlanDigest(plan));
    return { plan, planJson, packet };
  };
  return {
    root,
    config,
    configPath,
    planning,
    provider,
    saveProvider,
    publish,
    catalogInput,
    call,
    prepare,
    stateRoot,
    driveMount,
    registerPath,
    writeCredential,
    catalogStore,
    preparedStore,
    producer,
  };
}

test("serialized real producer completion retains exact packet, refuses stale/revised plans, recovers same ID without source", async (t) => {
  const f = await fixture(t);
  const missing = await f.call("tasks_prepare_completion");
  assert.equal(missing.report.code, "completion-source-projection-required");
  const catalog = await f.publish();
  const { plan, planJson, packet } = await f.prepare();
  const repeated = await f.prepare();
  assert.deepEqual(repeated.packet, packet);
  assert.deepEqual(repeated.plan, plan);
  assert.deepEqual(plan.target, target);
  assert.equal(plan.operation.name, "complete");
  assert.equal(plan.policyVersion, object(catalog).policyVersion);
  const raw = await f.call("tasks_apply_plan", {
    plan_json: JSON.stringify({ ...plan, operationId: "raw-bypass" }),
  });
  assert.equal(raw.report.code, "completion-prepared-packet-required");
  assert.equal(mutations(await f.provider()).length, 0);
  const changed = await f.provider();
  const changedTasks = objects(object(changed.tasks)["list-one"]);
  const decoy = changedTasks.find((row) => row.id === decoyId);
  assert.ok(decoy);
  decoy.title = "Concurrent provider edit";
  await f.saveProvider(changed);
  assert.equal(
    (await f.call("tasks_apply_plan", { plan_json: planJson })).report.code,
    "stale-snapshot",
  );
  decoy.title = title;
  await f.saveProvider(changed);
  const revisedInput = {
    ...f.catalogInput,
    coordinationDefinitionHash: "f".repeat(64),
  };
  await f.publish(revisedInput);
  const revised = await f.call("tasks_apply_plan", { plan_json: planJson });
  assert.equal(revised.report.code, "completion-policy-refused");
  assert.equal(mutations(await f.provider()).length, 0);
  await f.publish();
  const uncertain = await f.call("tasks_complete", {
    ...selector,
    plan_json: planJson,
  });
  assert.equal(uncertain.report.outcome, "uncertain");
  assert.equal(uncertain.report.code, "readback-unavailable");
  assert.equal(uncertain.report.taskId, originalId);
  const journalPath = join(
    f.stateRoot,
    "task-operations",
    `${sha256(plan.operationId)}.json`,
  );
  const journal = object(JSON.parse(await readFile(journalPath, "utf8")));
  assert.equal(journal.phase, "uncertain");
  assert.deepEqual(journal.plan, plan);
  assert.equal(journal.planDigest, taskExecutionPlanDigest(plan));
  const accepted = await f.provider();
  delete accepted.taskReadbackFailures;
  await f.saveProvider(accepted);
  // Neither new authority nor a producer installation is necessary to reconcile the old send.
  await writeFile(
    f.configPath,
    JSON.stringify({
      ...f.config,
      tasks: { credentials: f.config.tasks.credentials },
    }),
  );
  const recovered = await f.call("tasks_complete", {
    ...selector,
    plan_json: planJson,
  });
  assert.deepEqual(recovered.report, {
    schemaVersion: 1,
    operationId: plan.operationId,
    outcome: "applied",
    taskId: originalId,
    registerFresh: true,
  });
  assert.deepEqual(
    (await f.call("tasks_apply_plan", { plan_json: planJson })).report,
    recovered.report,
  );
  const final = await f.provider();
  assert.deepEqual(mutations(final), [
    {
      body: { status: "completed" },
      credential: f.writeCredential,
      method: "PATCH",
      scopes: ["https://www.googleapis.com/auth/tasks"],
      url: `https://tasks.googleapis.com/tasks/v1/lists/list-one/tasks/${originalId}`,
    },
  ]);
  const tasks = objects(object(final.tasks)["list-one"]);
  assert.equal(tasks.find((row) => row.id === originalId)?.status, "completed");
  assert.equal(tasks.find((row) => row.id === decoyId)?.status, "needsAction");
  const rows = objects(
    object(parse(await readFile(f.registerPath, "utf8"))).tasks,
  );
  assert.equal(
    rows.find((row) => row.task_id === originalId)?.status,
    "completed",
  );
  assert.equal(rows.find((row) => row.task_id === decoyId)?.status, "open");
  const recovery = configuredTaskRecoveryStore({
    stateRoot: f.stateRoot,
    driveMount: f.driveMount,
  });
  for (const reason of ["before-operation", "after-operation"] as const) {
    const summary = (await recovery.list(target)).find(
      (row) =>
        row.reason === reason &&
        row.operation?.operationId === plan.operationId,
    );
    assert.ok(summary);
    const snapshot = await recovery.read(summary.snapshotId);
    assert.equal(snapshot.operation?.planDigest, taskExecutionPlanDigest(plan));
    assert.equal(snapshot.operation?.taskId, originalId);
  }
  assert.equal(object(packet.intent).policyDigest, plan.policyVersion);
});

test("rotated authorization cannot resend an uncertain effect; original unresolved operation never resends", async (t) => {
  const f = await fixture(t, true);
  await f.publish();
  const original = await f.prepare();
  assert.equal(
    (await f.call("tasks_apply_plan", { plan_json: original.planJson })).report
      .outcome,
    "uncertain",
  );
  const authorization = objects(f.catalogInput.authorizations)[0];
  assert.ok(authorization);
  const rotatedInput = {
    ...f.catalogInput,
    authorizations: [
      { ...authorization, operationId: "rotated-authorization" },
    ],
  };
  await f.publish(rotatedInput);
  const rotated = await f.prepare();
  assert.notEqual(rotated.plan.operationId, original.plan.operationId);
  assert.equal(
    object(rotated.packet.intent).effectKey,
    object(original.packet.intent).effectKey,
  );
  const blocked = await f.call("tasks_apply_plan", {
    plan_json: rotated.planJson,
  });
  assert.equal(blocked.report.code, "completion-effect-reserved");
  assert.equal(mutations(await f.provider()).length, 1);
  const originalReplay = await f.call("tasks_apply_plan", {
    plan_json: original.planJson,
  });
  assert.equal(originalReplay.report.outcome, "uncertain");
  assert.equal(mutations(await f.provider()).length, 1);
  const unchanged = await f.provider();
  assert.equal(
    objects(object(unchanged.tasks)["list-one"]).find(
      (row) => row.id === originalId,
    )?.status,
    "needsAction",
  );
});

test("legacy uncertain completion journals fence new operation IDs without blocking original reconciliation", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const original = await f.prepare();
  const legacyPlan = {
    ...original.plan,
    operationId: "legacy-before-producer-integration",
  };
  const directory = join(f.stateRoot, "task-operations");
  await mkdir(directory, { mode: 0o700 });
  await writeFile(
    join(directory, `${sha256(legacyPlan.operationId)}.json`),
    JSON.stringify({
      schemaVersion: 1,
      plan: legacyPlan,
      planDigest: taskExecutionPlanDigest(legacyPlan),
      phase: "uncertain",
      taskId: originalId,
    }),
    { mode: 0o600 },
  );
  const blocked = await f.call("tasks_apply_plan", {
    plan_json: original.planJson,
  });
  assert.equal(
    blocked.report.code,
    "completion-original-operation-reconciliation-required",
  );
  assert.equal(mutations(await f.provider()).length, 0);
  await writeFile(
    f.configPath,
    JSON.stringify({
      ...f.config,
      tasks: { credentials: f.config.tasks.credentials },
    }),
  );
  const replay = await f.call("tasks_apply_plan", {
    plan_json: JSON.stringify(legacyPlan),
  });
  assert.equal(replay.report.outcome, "uncertain");
  assert.equal(replay.report.operationId, legacyPlan.operationId);
  assert.equal(mutations(await f.provider()).length, 0);
});

test("separately retained plan cannot substitute for the producer packet's actual API plan", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const original = await f.prepare();
  const substituted = {
    ...original.plan,
    operationId: "substituted-api-plan",
  };
  await f.preparedStore.prepare({
    packetJson: JSON.stringify(original.packet),
    plan: substituted,
  });
  const result = await f.call("tasks_apply_plan", {
    plan_json: JSON.stringify(substituted),
  });
  assert.equal(result.report.code, "completion-original-plan-mismatch");
  assert.equal(mutations(await f.provider()).length, 0);
});

test("post-send catalog owner loss reports uncertainty and reconciles original journal without another send", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const original = await f.prepare();
  const state = await f.provider();
  delete state.taskReadbackFailures;
  state.taskAfterPatchRenameDirectory = join(
    f.planning.privateRoot,
    "journal-ownership",
  );
  await f.saveProvider(state);
  const result = await f.call("tasks_apply_plan", {
    plan_json: original.planJson,
  });
  assert.equal(result.report.outcome, "uncertain");
  assert.equal(result.report.code, "completion-owner-failed");
  assert.equal(result.report.taskId, originalId);
  assert.equal(mutations(await f.provider()).length, 1);
  await writeFile(
    f.configPath,
    JSON.stringify({
      ...f.config,
      tasks: { credentials: f.config.tasks.credentials },
    }),
  );
  assert.equal(
    (await f.call("tasks_apply_plan", { plan_json: original.planJson })).report
      .outcome,
    "applied",
  );
  assert.equal(mutations(await f.provider()).length, 1);
});

test("configured local publisher retains original evidence, rejects stale/rollback source, and calls no provider", async (t) => {
  const f = await fixture(t);
  const sourcePath = f.planning.catalogSourcePath;
  const publishedSource = await f.producer.run({
    schemaVersion: 1,
    stage: "publish",
    catalog: f.catalogInput,
  });
  assert.equal(publishedSource.kind, "reported");
  if (publishedSource.kind !== "reported")
    throw new Error("Fixture producer failed");
  const versionedCatalog = object(publishedSource.data.catalog);
  const sourceRecord = {
    schemaVersion: 1,
    expectedPriorDigest: null as string | null,
    catalog: versionedCatalog,
    acquisitionEvidence: {
      kind: "synthetic-authorized-native-bridge-evidence",
      originalSourceRef: "test-only",
    },
  };
  await writeFile(sourcePath, JSON.stringify(sourceRecord), { mode: 0o600 });
  const publishCli = async () => {
    try {
      const result = await execute(
        process.execPath,
        [
          new URL("../../src/cli.js", import.meta.url).pathname,
          "tasks",
          "publish-completion-catalog",
          "--config",
          f.configPath,
          "--json",
        ],
        { timeout: 30_000 },
      );
      return { code: 0, report: object(JSON.parse(result.stdout)) };
    } catch (error) {
      assert.ok(error instanceof Error && "stdout" in error && "code" in error);
      return {
        code: error.code,
        report: object(JSON.parse(String(error.stdout))),
      };
    }
  };
  const published = await publishCli();
  assert.equal(published.code, 0, JSON.stringify(published));
  assert.equal(published.report.status, "published");
  assert.match(
    String(published.report.assurance),
    /cloud authorship not authenticated/u,
  );
  const observed = await f.catalogStore.withOwner((owner) => owner.read());
  assert.equal(observed.kind, "owned");
  if (observed.kind !== "owned" || observed.value === undefined)
    throw new Error("Missing published snapshot");
  const originalBytes = observed.value.rawJson;
  assert.deepEqual(
    JSON.parse(originalBytes.toString("utf8")),
    versionedCatalog,
  );
  const preparedFromPublishedSource = await f.prepare();
  assert.equal(
    preparedFromPublishedSource.plan.policyVersion,
    versionedCatalog.policyVersion,
  );
  const evidence = object(
    JSON.parse(observed.value.acquisitionJson.toString("utf8")),
  );
  assert.deepEqual(
    JSON.parse(
      Buffer.from(String(evidence.rawSourceBase64), "base64").toString("utf8"),
    ),
    sourceRecord,
  );
  assert.deepEqual(
    evidence.acquisitionEvidence,
    sourceRecord.acquisitionEvidence,
  );
  assert.equal(
    (await publishCli()).report.code,
    "completion-publication-prior-conflict",
  );
  sourceRecord.expectedPriorDigest = sha256Bytes(originalBytes);
  await writeFile(
    sourcePath,
    JSON.stringify({ ...sourceRecord, catalog: f.catalogInput }),
    { mode: 0o600 },
  );
  assert.equal((await publishCli()).report.status, "published");
  await writeFile(
    sourcePath,
    JSON.stringify({
      ...sourceRecord,
      catalog: {
        ...f.catalogInput,
        coordinationDefinitionHash: "e".repeat(64),
      },
    }),
    { mode: 0o600 },
  );
  assert.equal(
    (await publishCli()).report.code,
    "completion-publication-revision-conflict",
  );
  await writeFile(
    sourcePath,
    JSON.stringify({
      ...sourceRecord,
      catalog: { ...f.catalogInput, issuedAt: "2020-01-01T00:00:00.000Z" },
    }),
    { mode: 0o600 },
  );
  assert.equal((await publishCli()).report.code, "producer-rejected");
  const unchanged = await f.catalogStore.withOwner((owner) => owner.read());
  assert.equal(unchanged.kind, "owned");
  if (unchanged.kind !== "owned") throw new Error("Missing owner");
  assert.deepEqual(unchanged.value?.rawJson, originalBytes);
  assert.equal(mutations(await f.provider()).length, 0);
  await writeFile(sourcePath, JSON.stringify(sourceRecord), { mode: 0o600 });
  let done = false;
  let replaced = false;
  const running = publishCli().finally(() => {
    done = true;
  });
  while (!done && !replaced) {
    const names = await readdir(f.planning.privateRoot);
    if (names.some((name) => name.startsWith("emmy-planning-"))) {
      const temporary = join(f.planning.privateRoot, "replacement-source.tmp");
      await writeFile(
        temporary,
        JSON.stringify({
          ...sourceRecord,
          acquisitionEvidence: { changed: true },
        }),
        { mode: 0o600 },
      );
      await rename(temporary, sourcePath);
      replaced = true;
    }
  }
  const replacedResult = await running;
  assert.equal(
    replaced,
    true,
    "Must replace the staged source while its producer is running",
  );
  assert.equal(
    replacedResult.report.code,
    "completion-publication-source-changed",
  );
  const afterReplacement = await f.catalogStore.withOwner((owner) =>
    owner.read(),
  );
  assert.equal(afterReplacement.kind, "owned");
  if (afterReplacement.kind !== "owned") throw new Error("Missing owner");
  assert.deepEqual(afterReplacement.value?.rawJson, originalBytes);
});

function object(value: unknown): Record<string, unknown> {
  assert.ok(isJsonObject(value));
  return value;
}
function objects(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(object);
}
function mutations(value: Record<string, unknown>) {
  return objects(value.requests).filter((row) => row.method !== "GET");
}

test("serialized module attestation resolves standing source with no prelisted authorization and preserves uncertain recovery", async (t) => {
  const f = await fixture(t);
  const source: Record<string, unknown> = {
    ...f.catalogInput,
    authorizations: [],
  };
  await installStanding(f, source, null);
  const contextReply = await f.call("tasks_discover_completion");
  assert.equal(contextReply.isError, false);
  assert.equal(contextReply.report.status, "attestation-required");
  const context = object(contextReply.report.sourceContext);
  const attestation = {
    schemaVersion: 1,
    kind: "module-agent-attestation",
    attestationId: "synthetic-explicit-instruction-one",
    agentRef: "synthetic-module-session",
    ownerInstructionRef: "synthetic-owner-message-one",
    reportedAt: new Date().toISOString(),
    statement: "owner-explicitly-finished",
    target,
    listId: context.listId,
    taskId: originalId,
    sourceVersion: context.sourceVersion,
    sourceOccurrenceId: context.sourceOccurrenceId,
    sourceRange: context.sourceRange,
  };
  const prepare = (value: unknown) =>
    f.call("tasks_prepare_completion", {
      ...selector,
      completion_attestation_json: JSON.stringify(value),
    });
  assert.equal(
    (await prepare({ ...attestation, statement: "inferred-from-study" })).report
      .code,
    "completion-explicit-owner-attestation-required",
  );
  assert.equal(
    (await prepare({ ...attestation, taskId: decoyId })).report.code,
    "completion-attestation-scope-mismatch",
  );
  assert.equal(
    (await prepare({ ...attestation, sourceRange: "unrelated range" })).report
      .code,
    "completion-attestation-scope-mismatch",
  );
  assert.equal(
    (await prepare({ ...attestation, reportedAt: "2020-01-01T00:00:00.000Z" }))
      .report.code,
    "completion-attestation-stale",
  );
  assert.equal(mutations(await f.provider()).length, 0);
  const ready = await prepare(attestation);
  assert.equal(ready.isError, false, JSON.stringify(ready));
  assert.equal(ready.report.status, "prepared");
  const repeated = await prepare(attestation);
  assert.deepEqual(repeated.report.prepared, ready.report.prepared);
  const planJson = String(
    object(object(ready.report.call).arguments).plan_json,
  );
  const plan = parseTaskExecutionPlan(JSON.parse(planJson));
  const retained = await f.preparedStore.read(plan.operationId);
  assert.ok(retained?.acquisitionEvidenceJson);
  assert.match(retained.acquisitionEvidenceJson, /module-agent-attestation/u);
  const acquiredEvidence = object(JSON.parse(retained.acquisitionEvidenceJson));
  const sourceEvidence = object(
    JSON.parse(
      Buffer.from(
        String(object(acquiredEvidence.source).acquisitionBase64),
        "base64",
      ).toString("utf8"),
    ),
  );
  assert.equal(
    object(sourceEvidence.attestation).ownerInstructionRef,
    attestation.ownerInstructionRef,
  );
  assert.match(String(sourceEvidence.assurance), /chat not authenticated/u);
  const first = await f.call("tasks_apply_plan", { plan_json: planJson });
  assert.equal(first.report.outcome, "uncertain");
  assert.equal(mutations(await f.provider()).length, 1);
  const availableProvider = await f.provider();
  delete availableProvider.taskReadbackFailures;
  await f.saveProvider(availableProvider);
  await writeFile(
    f.configPath,
    JSON.stringify({
      ...f.config,
      tasks: { credentials: f.config.tasks.credentials },
    }),
  );
  const recovered = await f.call("tasks_apply_plan", { plan_json: planJson });
  assert.equal(recovered.report.outcome, "applied");
  assert.equal(recovered.report.taskId, originalId);
  assert.equal(mutations(await f.provider()).length, 1);
  assert.equal(
    (await f.call("tasks_apply_plan", { plan_json: planJson })).report.outcome,
    "applied",
  );
  assert.equal(mutations(await f.provider()).length, 1);
  const provider = await f.provider();
  const rows = objects(object(provider.tasks)["list-one"]);
  assert.equal(rows.find((row) => row.id === decoyId)?.status, "needsAction");
});

test("attested preparation refuses missing bindings and changed standing policy before send", async (t) => {
  const f = await fixture(t);
  const source: Record<string, unknown> = {
    ...f.catalogInput,
    authorizations: [],
  };
  await installStanding(
    f,
    { ...source, policy: { ...object(source.policy), bindings: [] } },
    null,
  );
  assert.equal(
    (await f.call("tasks_discover_completion")).report.code,
    "completion-source-binding-clarification-required",
  );
  const prior = await currentCatalogDigest(f);
  const revised = { ...source, issuedAt: new Date().toISOString() };
  await installStanding(f, revised, prior);
  const context = object(
    (await f.call("tasks_discover_completion")).report.sourceContext,
  );
  const ready = await f.call("tasks_prepare_completion", {
    ...selector,
    completion_attestation_json: JSON.stringify({
      schemaVersion: 1,
      kind: "module-agent-attestation",
      attestationId: "synthetic-policy-race",
      agentRef: "synthetic-session",
      ownerInstructionRef: "synthetic-message",
      reportedAt: new Date().toISOString(),
      statement: "owner-explicitly-finished",
      target,
      listId: context.listId,
      taskId: originalId,
      sourceVersion: context.sourceVersion,
      sourceOccurrenceId: context.sourceOccurrenceId,
      sourceRange: context.sourceRange,
    }),
  });
  assert.equal(ready.isError, false, JSON.stringify(ready));
  const planJson = String(
    object(object(ready.report.call).arguments).plan_json,
  );
  await installStanding(
    f,
    {
      ...revised,
      issuedAt: new Date().toISOString(),
      coordinationDefinitionHash: "9".repeat(64),
    },
    await currentCatalogDigest(f),
  );
  const refused = await f.call("tasks_apply_plan", { plan_json: planJson });
  assert.equal(refused.report.outcome, "conflict");
  assert.equal(
    refused.report.code,
    "completion-explicit-owner-attestation-required",
  );
  assert.equal(mutations(await f.provider()).length, 0);
});

async function currentCatalogDigest(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await f.catalogStore.withOwner((owner) => owner.read());
  assert.equal(result.kind, "owned");
  if (result.kind !== "owned" || !result.value)
    throw new Error("Missing synthetic source");
  return sha256Bytes(result.value.rawJson);
}

async function installStanding(
  f: Awaited<ReturnType<typeof fixture>>,
  catalog: unknown,
  expectedPriorDigest: string | null,
) {
  await writeFile(
    f.planning.catalogSourcePath,
    JSON.stringify({
      schemaVersion: 1,
      expectedPriorDigest,
      catalog,
      acquisitionEvidence: {
        kind: "synthetic-native-source-acquisition",
        sourceVersion: "synthetic-original-version",
        sourceRef: "synthetic-original-source",
      },
    }),
    { mode: 0o600 },
  );
  const result = await execute(
    process.execPath,
    [
      new URL("../../src/cli.js", import.meta.url).pathname,
      "tasks",
      "publish-completion-catalog",
      "--config",
      f.configPath,
      "--json",
    ],
    { timeout: 30_000 },
  );
  assert.equal(
    object(JSON.parse(result.stdout)).status,
    "standing-source-installed",
  );
}

test("attested resolution preserves producer prerequisite, owner-policy and original-evidence-age refusals", async (t) => {
  for (const scenario of [
    "prerequisite",
    "owner-policy",
    "stale-evidence",
  ] as const) {
    await t.test(scenario, async (child) => {
      const f = await fixture(child);
      const policy = structuredClone(object(f.catalogInput.policy));
      const occurrences = objects(policy.occurrences);
      const occurrence = occurrences[0];
      assert.ok(occurrence);
      if (scenario === "prerequisite") {
        const prior = {
          ...occurrence,
          id: "synthetic-unfinished-prerequisite",
          predecessors: [],
        };
        policy.occurrences = [
          { ...occurrence, predecessors: [prior.id] },
          prior,
        ];
      } else if (scenario === "owner-policy") {
        const binding = objects(policy.bindings)[0];
        assert.ok(binding);
        policy.ownerRules = [
          {
            id: "synthetic-owner-protection",
            identity: binding.identity,
            occurrenceId: occurrence.id,
            changes: { completed: false },
            observedAt: occurrence.observedAt,
            evidenceRef: "synthetic-retained-owner-rule",
            supersedes: null,
          },
        ];
      } else {
        policy.assignments = objects(policy.assignments).map((row) => ({
          ...row,
          observedAt: "2020-01-01T00:00:00.000Z",
        }));
      }
      await installStanding(
        f,
        { ...f.catalogInput, policy, authorizations: [] },
        null,
      );
      const context = object(
        (await f.call("tasks_discover_completion")).report.sourceContext,
      );
      const result = await f.call("tasks_prepare_completion", {
        ...selector,
        completion_attestation_json: JSON.stringify({
          schemaVersion: 1,
          kind: "module-agent-attestation",
          attestationId: `synthetic-${scenario}`,
          agentRef: "synthetic-session",
          ownerInstructionRef: "synthetic-explicit-finished-message",
          reportedAt: new Date().toISOString(),
          statement: "owner-explicitly-finished",
          target,
          listId: context.listId,
          taskId: originalId,
          sourceVersion: context.sourceVersion,
          sourceOccurrenceId: context.sourceOccurrenceId,
          sourceRange: context.sourceRange,
        }),
      });
      assert.equal(result.isError, true);
      assert.equal(result.report.code, "producer-rejected");
      assert.equal(mutations(await f.provider()).length, 0);
    });
  }
});

test("producer occurrence must agree with preserved creation or lifecycle source before first send", async (t) => {
  for (const scenario of [
    "creation-mismatch",
    "lifecycle-mismatch",
    "matching-creation",
    "provider-placeholder",
    "restored-provider-placeholder",
  ] as const) {
    await t.test(scenario, async (child) => {
      const f = await fixture(child);
      await installStanding(f, { ...f.catalogInput, authorizations: [] }, null);
      const context = object(
        (await f.call("tasks_discover_completion")).report.sourceContext,
      );
      const ready = await f.call("tasks_prepare_completion", {
        ...selector,
        completion_attestation_json: JSON.stringify({
          schemaVersion: 1,
          kind: "module-agent-attestation",
          attestationId: `synthetic-binding-${scenario}`,
          agentRef: "synthetic-session",
          ownerInstructionRef: "synthetic-finished-instruction",
          reportedAt: new Date().toISOString(),
          statement: "owner-explicitly-finished",
          target,
          listId: context.listId,
          taskId: originalId,
          sourceVersion: context.sourceVersion,
          sourceOccurrenceId: context.sourceOccurrenceId,
          sourceRange: context.sourceRange,
        }),
      });
      assert.equal(ready.isError, false, JSON.stringify(ready));
      const planJson = String(
        object(object(ready.report.call).arguments).plan_json,
      );
      const plan = parseTaskExecutionPlan(JSON.parse(planJson));
      const sourceId =
        scenario === "matching-creation"
          ? String(context.sourceOccurrenceId)
          : scenario === "provider-placeholder" ||
              scenario === "restored-provider-placeholder"
            ? `provider:${JSON.stringify([plan.listId, scenario === "restored-provider-placeholder" ? "synthetic-original-before-restore" : originalId])}`
            : "synthetic-preserved-other-occurrence";
      if (
        scenario === "creation-mismatch" ||
        scenario === "matching-creation"
      ) {
        const creation = parseTaskExecutionPlan({
          ...plan,
          operationId: `synthetic-prior-${scenario}`,
          sourceOccurrenceId: sourceId,
          operation: { name: "create", title },
        });
        const directory = join(f.stateRoot, "task-operations");
        await mkdir(directory, { mode: 0o700 });
        await writeFile(
          join(directory, `${sha256(creation.operationId)}.json`),
          JSON.stringify({
            schemaVersion: 1,
            plan: creation,
            planDigest: taskExecutionPlanDigest(creation),
            phase: "applied",
            taskId: originalId,
          }),
          { mode: 0o600 },
        );
      } else {
        await writeFile(
          join(f.stateRoot, "task-lifecycle.json"),
          JSON.stringify({
            schemaVersion: 1,
            revision: 1,
            entries: [
              {
                target: { kind: target.kind, key: target.key },
                occurrenceId: sourceId,
                source: { kind: "source-occurrence", id: sourceId },
                disposition: "active",
                recordedAt: new Date().toISOString(),
                evidenceRef: "synthetic-preserved-lifecycle-binding",
                providers: [
                  ...(scenario === "restored-provider-placeholder"
                    ? [
                        {
                          canonical: {
                            listId: plan.listId,
                            taskId: "synthetic-original-before-restore",
                          },
                          aliases: [],
                        },
                      ]
                    : []),
                  {
                    canonical: { listId: plan.listId, taskId: originalId },
                    aliases: [],
                  },
                ],
              },
            ],
          }),
          { mode: 0o600 },
        );
      }
      const state = await f.provider();
      delete state.taskReadbackFailures;
      await f.saveProvider(state);
      const result = await f.call("tasks_apply_plan", { plan_json: planJson });
      if (scenario.endsWith("mismatch")) {
        assert.equal(result.report.outcome, "conflict");
        assert.equal(
          result.report.code,
          "completion-retained-source-binding-mismatch",
        );
        assert.equal(mutations(await f.provider()).length, 0);
      } else {
        assert.equal(result.report.outcome, "applied", JSON.stringify(result));
        assert.equal(result.report.taskId, originalId);
        assert.equal(mutations(await f.provider()).length, 1);
      }
    });
  }
});
