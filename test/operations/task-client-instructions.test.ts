import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateAgents } from "../../src/conformance/validate-agents.js";
import { planResearchProjectConformance } from "../../src/conformance/index.js";
import { loadModuleContract } from "../../src/contract/load-module-contract.js";
import { loadResearchProjectContract } from "../../src/contract/load-research-project-contract.js";
import {
  createMcpDispatcher,
  createTaskTools,
} from "../../src/operations/index.js";
import { createModuleCompletionTools } from "../../src/operations/module-completion-tools.js";
import { guardedTaskTools } from "../../src/operations/task-plan-tools.js";
import { createTaskLifecycleExecutionChecks } from "../../src/tasks/configured-task-executor.js";
import type { TaskOperationJournalRecord } from "../../src/tasks/task-execution-types.js";
import {
  emptyTaskLifecycleState,
  executeTaskPlan,
  parseTaskExecutionPlan,
  recordTaskLifecycle,
  type TaskTargetIdentity,
  type TaskOperationWriter,
} from "../../src/tasks/index.js";
import {
  createFakeTaskList,
  createInMemoryTaskRegisterStore,
} from "../support/fake-task-list.js";

test("shipped routers and settlement procedures reach the served task-plan protocol", async () => {
  const [module, research, setup] = await Promise.all([
    loadModuleContract(),
    loadResearchProjectContract(),
    readFile("docs/machine-setup.md", "utf8"),
  ]);
  const moduleRouter = validateAgents(module.pinnedDocuments.agents);
  assert.equal(moduleRouter.status, "pass", moduleRouter.evidence);
  const researchRouter = planResearchProjectConformance({
    contract: research,
    target: {
      key: "fixture-project",
      root: "Modules/Research",
      folder: "Fixture project",
      status: "active",
    },
    inventory: { projectKey: "fixture-project", entries: [] },
    controls: { agents: research.seedFiles["AGENTS.md"] ?? "" },
  }).findings.find((finding) => finding.ruleId === "RP-AGENTS-001");
  assert.equal(
    researchRouter?.status,
    "pass",
    researchRouter?.evidence ?? "Missing Research router finding",
  );
  const fixture = taskClientFixture(false);
  const readRegister = fixture.tools.find(
    (tool) => tool.name === "tasks_read_register",
  );
  assert.ok(readRegister);
  const completionTools = createModuleCompletionTools({
    readRegister,
    producer: {
      catalog: async () => {
        throw new Error("Inventory fixture only");
      },
      discover: async () => {
        throw new Error("Inventory fixture only");
      },
      acquire: async () => {
        throw new Error("Inventory fixture only");
      },
    },
  });
  const names = new Set(
    [...fixture.tools, ...completionTools].map((tool) => tool.name),
  );
  for (const text of [
    module.pinnedDocuments.agents,
    research.seedFiles["AGENTS.md"],
    setup,
  ]) {
    assert.ok(text);
    for (const [name] of text.matchAll(
      /\b(?:tasks|research_tasks)_[a-z_]+\b/gu,
    ))
      assert.ok(names.has(name), `Instruction names an unserved tool: ${name}`);
    for (const field of [
      "task-plan/1",
      "policyVersion",
      "operationId",
      "sourceOccurrenceId",
      "plan_json",
      "expectedSnapshot",
    ])
      assert.ok(
        text.includes(field),
        `Missing migration requirement: ${field}`,
      );
    assert.match(text, /notes\/descriptions[\s\S]*refused/u);
    assert.match(
      text,
      /`doDate` or `timing`[\s\S]*refused|refused[\s\S]*`doDate` or `timing`/u,
    );
    assert.match(text, /authorized UI executor/u);
    assert.match(text, /account\/list\/task IDs/u);
    assert.match(text, /same-ID Task saved-field readback/u);
    assert.match(text, /contradictory|Contradictory/u);
    assert.match(text, /ordinary.event/u);
  }
  for (const router of [
    module.pinnedDocuments.agents,
    research.seedFiles["AGENTS.md"],
  ]) {
    assert.ok(router);
    assert.match(router, /immutable plan/u);
    assert.match(router, /unknown-ID\s+create stays fenced/u);
    assert.match(router, /conflicts to planning/u);
    assert.match(router, /never invents or\s+replans/u);
  }
  for (const procedure of [
    module.pinnedDocuments.teachingProcedure,
    research.seedFiles["docs/20 Research Procedure.md"],
  ]) {
    assert.ok(procedure);
    assert.match(procedure, /Tasks\s+protocol in `AGENTS.md`/u);
    assert.match(procedure, /explicitly (?:reported )?complete/u);
    assert.match(procedure, /native UI delegation and evidence/u);
    assert.match(procedure, /dismissals/u);
  }
  assert.doesNotMatch(setup, /four `tasks_\*`/u);
  assert.match(setup, /catalog after connecting or upgrading/u);
  assert.match(setup, /isolated fixtures before enabling writes/u);
});

for (const research of [false, true]) {
  const prefix = research ? "research_tasks" : "tasks";
  test(`${prefix} clients negotiate and execute all three documented compatibility operations through real MCP schemas`, async () => {
    const fixture = taskClientFixture(research);
    const capabilities = await fixture.call("tasks_sync_capabilities", {});
    assert.equal(capabilities.report.protocol, "task-plan/1");
    let createdId = "";
    for (const name of ["create", "change", "complete"] as const) {
      const before = fixture.list.tasks();
      const legacy = {
        ...fixture.identityArguments,
        ...(name === "create"
          ? { title: "Fixture accepted action" }
          : { task_id: "existing" }),
        ...(name === "change" ? { title: "Fixture renamed" } : {}),
      };
      const missing = await fixture.call(`${prefix}_${name}`, legacy);
      assert.equal(missing.isError, true);
      assert.equal(missing.report.code, "exact-plan-required");
      assert.deepEqual(fixture.list.tasks(), before);
      const read = await fixture.call(
        `${prefix}_read_register`,
        fixture.identityArguments,
      );
      assert.equal(read.isError, false);
      assert.equal(read.report.outcome, "read");
      const execution = read.report.execution;
      const operation =
        name === "create"
          ? { name, title: "Fixture accepted action" }
          : name === "change"
            ? { name, taskId: "existing", title: "Fixture renamed" }
            : { name, taskId: "existing" };
      const plan = {
        schemaVersion: 1,
        operationId: `${prefix}-${name}`,
        target: execution.target,
        listId: execution.listId,
        expectedSnapshot: execution.expectedSnapshot,
        operation,
        policyVersion: "fixture-policy",
        ...(name === "create"
          ? { sourceOccurrenceId: "fixture-accepted-source" }
          : {}),
      };
      const reply = await fixture.call(`${prefix}_${name}`, {
        ...legacy,
        plan_json: JSON.stringify(plan),
      });
      assert.equal(reply.isError, false);
      assert.equal(reply.report.outcome, "applied");
      assert.equal(reply.report.operationId, plan.operationId);
      assert.equal(reply.report.registerFresh, true);
      assert.equal(typeof reply.report.taskId, "string");
      if (name === "create") createdId = reply.report.taskId;
      else assert.equal(reply.report.taskId, "existing");
      const applied = fixture.list.tasks();
      const sends = fixture.mutationCalls();
      const replay = await fixture.call(`${prefix}_${name}`, {
        ...legacy,
        plan_json: JSON.stringify(plan),
      });
      assert.equal(replay.isError, false);
      assert.deepEqual(replay.report, reply.report);
      assert.equal(fixture.mutationCalls(), sends);
      assert.deepEqual(fixture.list.tasks(), applied);
    }
    assert.ok(createdId);
    assert.equal(
      fixture.list.tasks().filter((task) => task.id === createdId).length,
      1,
    );
    assert.deepEqual(
      fixture.list.tasks().find((task) => task.id === "existing"),
      {
        id: "existing",
        title: "Fixture renamed",
        status: "completed",
        due: "2030-01-01T00:00:00.000Z",
      },
    );
    const read = await fixture.call(
      `${prefix}_read_register`,
      fixture.identityArguments,
    );
    const plan = {
      schemaVersion: 1,
      operationId: `${prefix}-date`,
      target: read.report.execution.target,
      listId: read.report.execution.listId,
      expectedSnapshot: read.report.execution.expectedSnapshot,
      operation: { name: "change", taskId: createdId, doDate: "2030-01-02" },
      policyVersion: "fixture-policy",
    };
    const before = fixture.list.tasks();
    const dated = await fixture.call("tasks_apply_plan", {
      plan_json: JSON.stringify(plan),
    });
    assert.equal(dated.isError, true);
    assert.equal(dated.report.code, "native-timing-unavailable");
    const notes = await fixture.call(`${prefix}_change`, {
      ...fixture.identityArguments,
      task_id: createdId,
      notes: "refused",
      plan_json: JSON.stringify({
        ...plan,
        operationId: `${prefix}-notes`,
        operation: { name: "change", taskId: createdId, title: "Fixture" },
      }),
    });
    assert.equal(notes.isError, true);
    assert.deepEqual(fixture.list.tasks(), before);
  });
}

function taskClientFixture(research: boolean) {
  const identity: TaskTargetIdentity = research
    ? {
        kind: "research-project",
        key: "fixture-project",
        title: "Fixture project",
      }
    : { kind: "module", key: "FIXTURE/MOD1", title: "MOD1" };
  const identityArguments: Record<string, string> = research
    ? { research_project: "fixture-project" }
    : { semester: "FIXTURE", module: "MOD1" };
  const list = createFakeTaskList({
    listId: "fixture-list",
    tasks: [
      {
        id: "existing",
        title: "Fixture source",
        status: "needsAction",
        due: "2030-01-01T00:00:00.000Z",
      },
    ],
  });
  let mutationCalls = 0;
  const writer: TaskOperationWriter = {
    ...list.writer,
    createTask: async (input) => {
      mutationCalls++;
      return list.writer.createTask(input);
    },
    patchTask: async (input) => {
      mutationCalls++;
      return list.writer.patchTask(input);
    },
    deleteTask: async (input) => {
      mutationCalls++;
      return list.writer.deleteTask(input);
    },
  };
  const registerStore = createInMemoryTaskRegisterStore({
    listId: "fixture-list",
    tasks: [],
  });
  const target = { identity, registerStore };
  let lifecycle = emptyTaskLifecycleState();
  const records = new Map<string, TaskOperationJournalRecord>();
  const tools = guardedTaskTools(
    createTaskTools({
      target: () => ({ semester: "FIXTURE", module: "MOD1", registerStore }),
      researchProjectTarget: () => target,
      reader: list.reader,
      writer,
    }),
    {
      apply: async (value) => {
        const plan = parseTaskExecutionPlan(value);
        return executeTaskPlan({
          plan,
          target,
          reader: list.reader,
          writer,
          journal: {
            withOwner: async (scope, run) =>
              run({
                read: async () =>
                  structuredClone(records.get(scope.operationId)),
                write: async (record) => {
                  records.set(scope.operationId, structuredClone(record));
                },
              }),
          },
          checks: await createTaskLifecycleExecutionChecks(
            {
              read: async () => structuredClone(lifecycle),
              record: async (entry) => {
                lifecycle = recordTaskLifecycle(lifecycle, entry);
                return lifecycle;
              },
            },
            plan,
          ),
        });
      },
    },
  );
  const dispatch = createMcpDispatcher({
    tools,
    serverInfo: { name: "fixture", title: "Fixture", version: "2.0.0" },
  });
  return {
    list,
    tools,
    identityArguments,
    mutationCalls: () => mutationCalls,
    call: async (name: string, arguments_: Record<string, string>) => {
      const response = await dispatch({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: arguments_ },
      });
      assert.ok(response);
      assert.equal(response.error, undefined);
      const result = response.result as {
        isError: boolean;
        content: { text: string }[];
      };
      return {
        isError: result.isError,
        report: JSON.parse(result.content[0]?.text ?? ""),
      };
    },
  };
}
