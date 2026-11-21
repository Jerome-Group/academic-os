import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { taskRegisterPath } from "../../src/contract/task-register.js";
import { createMcpDispatcher } from "../../src/operations/dispatch-mcp-message.js";
import {
  createConfiguredOperationsTools,
  OPERATIONS_SERVER_INFO,
} from "../../src/operations/run-operations-server.js";

test("configured final study preserves a legacy attempt and reconciles renamed and recreated reviews", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aos-final-study-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Semester", "XX1234");
  const finals = "30 Assessments/40 Finals";
  const stem = `${finals}/XX1234_XX4321_Final_2021-2022`;
  const questions = `${stem}_Questions.pdf`;
  const solutions = `${stem}_Solutions.pdf`;
  const later = `${finals}/XX1234_Final_2023-2024_Questions.pdf`;
  const register = join(moduleRoot, taskRegisterPath);
  const records = join(moduleRoot, "70 Learning/40 Past Papers/records");
  const grading = join(records, "0001-full-attempt.md");
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(join(moduleRoot, "00 Module Admin"), { recursive: true });
  await mkdir(join(moduleRoot, finals), { recursive: true });
  await mkdir(records, { recursive: true });
  await writeFile(grading, "Legacy attempt and feedback: 64/100.\n");
  await writeFile(join(moduleRoot, questions), "Synthetic questions");
  await writeFile(join(moduleRoot, solutions), "Synthetic solutions");
  await writeFile(join(moduleRoot, later), "Synthetic later questions");
  await writeFile(
    register,
    [
      "list_id: module-list",
      "tasks:",
      "  - task_id: legacy",
      "    title: XX1234 21/22 Final",
      "    status: open",
      "    notes: Prior grading notes.",
      "  - task_id: same-id",
      "    title: XX1234 21/22 Final",
      "    status: open",
      "    provenance:",
      "      source: Prior session plan",
      "  - task_id: removed-id",
      "    title: XX1234 23/24 Final",
      "    status: open",
      "",
    ].join("\n"),
  );
  const config = join(root, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Semester", status: "active", modules: ["XX1234"] },
      },
      tasks: {
        credentials: {
          scheduledRead: join(root, "fake-read.json"),
          interactiveWrite: join(root, "fake-write.json"),
        },
      },
    }),
  );
  const provider = join(root, "provider.json");
  const providerTasks = [
    {
      id: "legacy",
      title: "XX1234 21/22 Final",
      status: "needsAction",
      notes: "Prior grading notes.",
    },
    {
      id: "same-id",
      title: "XX4321 21/22 Final Review",
      status: "needsAction",
      due: "2026-08-21T00:00:00.000Z",
    },
    { id: "new-id", title: "XX1234 23/24 Final Review", status: "needsAction" },
    {
      id: "open-attempt",
      title: "XX1234 22/23 Final",
      status: "needsAction",
      notes: "Keep this note.",
    },
  ];
  const switchPaper = `${finals}/XX1234_Final_2022-2023_Questions.pdf`;
  await writeFile(join(moduleRoot, switchPaper), "Synthetic switch questions");
  await writeFile(
    provider,
    JSON.stringify({
      lists: [{ id: "module-list", title: "XX1234" }],
      tasks: { "module-list": providerTasks },
    }),
  );
  process.env.ACADEMIC_OS_FAKE_TASKS_STATE = provider;
  t.after(() => {
    delete process.env.ACADEMIC_OS_FAKE_TASKS_STATE;
  });
  await import("../support/fake-tasks-preload.js");
  const dispatch = createMcpDispatcher({
    tools: await createConfiguredOperationsTools(config),
    serverInfo: OPERATIONS_SERVER_INFO,
  });
  const call = async (
    name: string,
    args: Record<string, string> = {},
    failed = false,
  ) => {
    const reply = await dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: { semester: "Y2S1", module: "XX1234", ...args },
      },
    });
    assert.ok(reply?.result, JSON.stringify(reply));
    const result = reply.result as {
      isError: boolean;
      content: [{ text: string }];
    };
    assert.equal(result.isError, failed, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const inspect = (request: string) =>
    call("tasks_final_study", { action: "inspect", request });
  const finish = (task_id: string, request: string, failed = false) =>
    call(
      "tasks_final_study",
      { action: "complete-review", request, task_id },
      failed,
    );
  const writes = async () => {
    const state = JSON.parse(await readFile(provider, "utf8"));
    return state.requests
      .filter(({ method }: { method: string }) => method !== "GET")
      .map(({ url, body }: { url: string; body: unknown }) => [
        url.split("/").at(-1),
        body,
      ]);
  };
  const status = async () => parse(await readFile(register, "utf8")).tasks;
  const recordReview = async (number: string, taskId: string, file: string) => {
    await writeFile(
      join(records, `${number}-final-review.md`),
      [
        "---",
        "kind: session",
        "status: complete",
        "mode: final-review",
        `task_id: ${taskId}`,
        "sources:",
        `  - file: ${file}`,
        "    locator: Question 1",
        "---",
        "Synthetic review coverage.",
        "",
      ].join("\n"),
    );
  };
  const renameOnProvider = async (taskId: string, title: string) => {
    const state = JSON.parse(await readFile(provider, "utf8"));
    const task = state.tasks["module-list"].find(
      ({ id }: { id: string }) => id === taskId,
    );
    assert.ok(task);
    task.title = title;
    await writeFile(provider, JSON.stringify(state));
  };

  const legacy = await inspect("XX1234 21/22 Final");
  assert.equal(legacy.mode, "attempt");
  assert.equal(legacy.sources.questions.file, questions);
  assert.equal(legacy.sources.solutions.file, solutions);
  assert.equal(legacy.entry.covered, false);
  assert.deepEqual(
    legacy.entry.tasks.map(({ taskId }: { taskId: string }) => taskId),
    ["legacy", "same-id"],
  );
  assert.equal(
    (await call("tasks_complete", { task_id: "legacy" })).taskId,
    "legacy",
  );
  assert.equal(
    (await call("tasks_complete", { task_id: "legacy" })).outcome,
    "applied",
  );

  const renamed = await inspect("review XX4321 21/22");
  assert.deepEqual(renamed.sources, legacy.sources);
  assert.equal(renamed.paper, legacy.paper);
  assert.equal(renamed.entry.attemptTaskCompleted, true);
  assert.equal(renamed.entry.reviewed, false);
  assert.equal(
    (await finish("legacy", "review XX1234 21/22", true)).failure.code,
    "invalid-target",
  );
  assert.equal(
    (await finish("same-id", "review XX1234 21/22", true)).failure.code,
    "missing-target",
  );
  await recordReview("0002", "same-id", questions);
  const first = await finish("same-id", "review XX1234 21/22");
  assert.equal(first.taskId, "same-id");
  assert.equal(first.entry.assessment, questions);
  assert.equal(first.entry.covered, true);
  assert.equal(first.entry.reviewed, true);
  assert.equal(first.entry.attemptTaskCompleted, true);
  assert.equal(
    (await finish("same-id", "XX1234 21/22 Final Review")).outcome,
    "already-completed",
  );

  const recreated = await inspect("XX1234 23/24 Final Review");
  assert.equal(recreated.sources.questions.file, later);
  assert.equal(recreated.sources.solutions, null);
  assert.equal(recreated.entry.covered, false);
  assert.equal(
    (await finish("removed-id", "review XX1234 23/24", true)).failure.code,
    "invalid-target",
  );
  await recordReview("0003", "new-id", later);
  const fresh = await finish("new-id", "review XX1234 23/24");
  assert.equal(fresh.taskId, "new-id");
  assert.equal(fresh.entry.assessment, later);
  assert.equal(fresh.entry.covered, true);
  assert.equal(fresh.entry.reviewed, true);
  assert.equal(fresh.entry.attemptTaskCompleted, false);
  assert.equal(
    (await finish("new-id", "review XX1234 23/24")).outcome,
    "already-completed",
  );

  const switched = await call("tasks_final_study", {
    action: "switch",
    request: "review XX1234 22/23",
    task_id: "open-attempt",
  });
  assert.equal(switched.taskId, "open-attempt");
  await renameOnProvider("open-attempt", "Study this paper tomorrow");
  assert.equal(
    (await inspect("review XX1234 22/23")).entry.unresolved[0].taskId,
    "open-attempt",
  );
  const switchedBack = await call("tasks_final_study", {
    action: "switch",
    request: switchPaper,
    task_id: "open-attempt",
  });
  assert.equal(switchedBack.taskId, switched.taskId);
  const beforeRefresh = await readFile(register, "utf8");
  await call("tasks_read_register");
  assert.equal(await readFile(register, "utf8"), beforeRefresh);
  assert.deepEqual((await inspect("review XX1234 21/22")).entry, first.entry);
  assert.deepEqual((await inspect("XX1234 23/24 Final")).entry, fresh.entry);
  assert.equal(
    await readFile(grading, "utf8"),
    "Legacy attempt and feedback: 64/100.\n",
  );
  assert.deepEqual(
    (await status()).map((row: { task_id: string }) => row.task_id),
    ["legacy", "same-id", "removed-id", "new-id", "open-attempt"],
  );
  assert.deepEqual((await status())[1], {
    task_id: "same-id",
    title: "XX4321 21/22 Final Review",
    status: "completed",
    do_date: "2026-08-21",
    provenance: { source: "Prior session plan", assessment: questions },
  });
  assert.equal((await status())[2].status, "cancelled");
  assert.deepEqual((await status())[4], {
    task_id: "open-attempt",
    title: "XX1234 22/23 Final",
    status: "open",
    notes: "Keep this note.",
    provenance: { assessment: switchPaper },
  });

  await writeFile(
    join(
      moduleRoot,
      `${finals}/XX1234_Final_2022-2023_Semester_1_Questions.pdf`,
    ),
    "Another paper in the same year",
  );
  const refusal = await call(
    "tasks_final_study",
    {
      action: "switch",
      request: "review XX1234 22/23",
      task_id: "open-attempt",
    },
    true,
  );
  assert.equal(refusal.failure.code, "ambiguous-target");
  assert.match(refusal.failure.message, /Semester_1_Questions/u);
  assert.equal(
    (
      await call(
        "tasks_final_study",
        {
          action: "inspect",
          request: "review 22/23",
        },
        true,
      )
    ).failure.code,
    "missing-target",
  );
  assert.equal(
    (await inspect(`review ${switchPaper}`)).sources.questions.file,
    switchPaper,
  );
  await renameOnProvider("new-id", "XX1234 23/24 Final");
  const historicalReview = (await inspect("XX1234 23/24 Final")).entry;
  assert.equal(historicalReview.reviewed, true);
  assert.equal(historicalReview.attemptTaskCompleted, false);
  assert.equal(historicalReview.reviewRecords[0].taskId, "new-id");
  assert.equal(
    (await finish("new-id", "review XX1234 23/24")).outcome,
    "already-completed",
  );
  const laterAttempt = await call("tasks_create", {
    title: "XX1234 23/24 Final",
    assessment: later,
  });
  await call("tasks_complete", { task_id: laterAttempt.taskId });
  const bothModes = (await inspect("XX1234 23/24 Final")).entry;
  assert.equal(bothModes.assessment, later);
  assert.equal(bothModes.reviewed, true);
  assert.equal(bothModes.attemptTaskCompleted, true);
  assert.deepEqual(
    bothModes.tasks
      .filter(({ status }: { status: string }) => status === "completed")
      .map(({ taskId, mode }: { taskId: string; mode: string }) => [
        taskId,
        mode,
      ]),
    [
      ["new-id", "review"],
      [laterAttempt.taskId, "attempt"],
    ],
  );
  await call("tasks_complete", { task_id: "open-attempt" });
  await renameOnProvider("open-attempt", "XX1234 22/23 Final Review");
  assert.equal((await inspect(`review ${switchPaper}`)).entry.reviewed, false);
  assert.deepEqual(await writes(), [
    ["legacy", { status: "completed" }],
    ["legacy", { status: "completed" }],
    ["same-id", { status: "completed" }],
    ["new-id", { status: "completed" }],
    ["open-attempt", { title: "XX1234 22/23 Final Review" }],
    ["open-attempt", { title: "XX1234 22/23 Final" }],
    ["tasks", { title: "XX1234 23/24 Final" }],
    [laterAttempt.taskId, { status: "completed" }],
    ["open-attempt", { status: "completed" }],
  ]);
});
