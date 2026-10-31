import assert from "node:assert/strict";
import { test } from "node:test";

import { createMcpDispatcher } from "../../src/operations/dispatch-mcp-message.js";
import { guardedTaskTools } from "../../src/operations/task-plan-tools.js";
import { createTaskTools } from "../../src/operations/task-tools.js";
import type { OperationToolResult } from "../../src/operations/types.js";
import { isJsonObject } from "../../src/operations/json-object.js";
import {
  createModuleCompletionTools,
  type ModuleCompletionProducer,
} from "../../src/operations/module-completion-tools.js";
import {
  parseTaskExecutionPlan,
  taskExecutionSnapshot,
} from "../../src/tasks/task-execution-plan.js";
import type { TaskRegister } from "../../src/tasks/types.js";

const target = {
  kind: "module",
  key: "fixture-semester/XX0000",
  title: "XX0000",
};
const live = [
  { id: "fixture-original", title: "Same title", status: "needsAction" },
  { id: "fixture-decoy", title: "Same title", status: "needsAction" },
] satisfies Parameters<typeof taskExecutionSnapshot>[0];
const arguments_ = {
  semester: "fixture-semester",
  module: "XX0000",
  task_id: "fixture-original",
};
const fixturePlan = {
  schemaVersion: 1,
  operationId: "fixture-authorized-operation",
  target,
  listId: "fixture-list",
  expectedSnapshot: taskExecutionSnapshot(live),
  operation: { name: "complete", taskId: "fixture-original" },
  policyVersion: "fixture-policy-only",
};
const serverInfo = {
  name: "fixture",
  title: "Fixture dispatcher",
  version: "1",
};

function fixture(
  input: {
    operations?: string[];
    plan?: unknown;
    ready?: boolean;
    unavailable?: boolean;
    failRead?: boolean;
    refusal?: unknown;
    mutateObservation?: (value: OperationToolResult) => OperationToolResult;
  } = {},
) {
  let register: TaskRegister = { listId: "fixture-list", tasks: [] };
  const events: string[] = [];
  const prepared = {
    fixture: "Opaque original packet; not a production producer wire schema",
  };
  let officialObservation: OperationToolResult | undefined;
  const producer: ModuleCompletionProducer = {
    catalog: async () => {
      events.push("catalog");
      return { fixture: true };
    },
    discover: async (_catalog, selector) => {
      events.push("discover");
      assert.deepEqual(selector, {
        target,
        listId: "fixture-list",
        taskId: "fixture-original",
      });
      return input.operations ?? [fixturePlan.operationId];
    },
    acquire: async (_catalog, request, observation) => {
      events.push("acquire");
      assert.equal(observation, officialObservation);
      assert.ok(isJsonObject(observation.report));
      assert.ok(isJsonObject(observation.report.register));
      assert.ok(isJsonObject(observation.report.execution));
      assert.equal(observation.failed, false);
      assert.equal(observation.report.execution.protocol, "task-plan/1");
      assert.deepEqual(observation.report.execution.target, target);
      assert.equal(observation.report.register.freshness, "fresh");
      assert.equal(
        observation.report.register.providerSnapshot,
        fixturePlan.expectedSnapshot,
      );
      assert.equal("policy" in observation, false);
      assert.equal(request.operationId, fixturePlan.operationId);
      return input.ready === false
        ? { ready: false, refusal: input.refusal ?? "fixture-refusal" }
        : {
            ready: true,
            prepared,
            call: {
              tool: "tasks_apply_plan",
              arguments: {
                plan_json: JSON.stringify(input.plan ?? fixturePlan),
              },
            },
          };
    },
  };
  const guarded = guardedTaskTools(
    createTaskTools({
      target: (module) => ({
        ...module,
        registerStore: {
          read: async () => register,
          write: async (value) => {
            register = value;
          },
        },
      }),
      reader: {
        listTasks: async () => {
          events.push("official-read");
          if (input.failRead) throw new Error("Fixture provider unavailable");
          return structuredClone(live);
        },
      },
      writer: {
        createTask: async () => {
          throw new Error("Unexpected mutation");
        },
        patchTask: async () => {
          throw new Error("Unexpected mutation");
        },
        readTask: async () => {
          throw new Error("Unexpected mutation");
        },
        deleteTask: async () => {
          throw new Error("Unexpected mutation");
        },
      },
    }),
    {
      apply: async () => {
        throw new Error("Unexpected apply");
      },
    },
  );
  const readRegister = guarded.find(
    (tool) => tool.name === "tasks_read_register",
  );
  assert.ok(readRegister);
  const tools = createModuleCompletionTools(
    input.unavailable
      ? undefined
      : {
          producer,
          readRegister: {
            ...readRegister,
            call: async (values) => {
              const official = await readRegister.call(values);
              officialObservation =
                input.mutateObservation?.(official) ?? official;
              return officialObservation;
            },
          },
        },
  );
  const dispatch = createMcpDispatcher({ tools, serverInfo });
  return {
    events,
    prepared,
    call: async (
      name: string,
      supplied: Record<string, string> = arguments_,
    ) => {
      const response = await dispatch({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: supplied },
      });
      assert.ok(response);
      if (response.error) return { protocolError: response.error };
      assert.ok(isJsonObject(response.result));
      assert.ok(Array.isArray(response.result.content));
      const content: unknown = response.result.content[0];
      assert.ok(isJsonObject(content));
      assert.equal(typeof content.text, "string");
      const report: unknown = JSON.parse(String(content.text));
      assert.ok(isJsonObject(report));
      return { isError: response.result.isError, report };
    },
  };
}

test("normalized fixture adapter validates the exact task but withholds the packet and raw apply call", async () => {
  const run = fixture();
  const result = await run.call("tasks_prepare_completion");
  assert.equal(result.isError, true);
  assert.equal(result.report?.code, "completion-execution-binding-unavailable");
  assert.equal(result.report?.prepared, undefined);
  assert.equal(result.report?.call, undefined);
  assert.deepEqual(run.events, [
    "official-read",
    "catalog",
    "discover",
    "acquire",
  ]);
});

test("discovery performs a fresh official read and never acquires", async () => {
  const run = fixture();
  const result = await run.call("tasks_discover_completion");
  assert.equal(result.report?.operationId, fixturePlan.operationId);
  assert.deepEqual(run.events, ["official-read", "catalog", "discover"]);
});

test("unconfigured factory reports unavailable and omits preparation", async () => {
  const run = fixture({ unavailable: true });
  assert.equal(
    (await run.call("tasks_completion_capabilities", {})).report?.status,
    "unavailable",
  );
  assert.equal(
    (await run.call("tasks_prepare_completion")).protocolError?.code,
    -32602,
  );
  assert.deepEqual(run.events, []);
});

test("missing, ambiguous and stale observations refuse before acquisition", async () => {
  for (const input of [
    { operations: [], expected: "completion-authorization-missing" },
    {
      operations: ["first", "second"],
      expected: "completion-authorization-ambiguous",
    },
    { failRead: true, expected: "fresh-register-required" },
  ]) {
    const run = fixture(input);
    const result = await run.call("tasks_prepare_completion");
    assert.equal(result.isError, true);
    assert.equal(result.report?.code, input.expected);
    assert.ok(!run.events.includes("acquire"));
    if (input.operations?.length === 2)
      assert.deepEqual(result.report?.choices, input.operations);
  }
});

test("caller cannot supply policy, paths, plans or an arbitrary operation identity", async () => {
  for (const field of ["policyVersion", "path", "plan_json", "operationId"]) {
    const run = fixture();
    assert.equal(
      (
        await run.call("tasks_prepare_completion", {
          ...arguments_,
          [field]: "untrusted",
        })
      ).protocolError?.code,
      -32602,
    );
    assert.deepEqual(run.events, []);
  }
});

test("producer refusal and every immutable plan mismatch fail closed", async () => {
  const refused = fixture({ ready: false });
  assert.equal(
    (await refused.call("tasks_prepare_completion")).report?.code,
    "producer-not-ready",
  );
  for (const plan of [
    { ...fixturePlan, schemaVersion: 2 },
    { ...fixturePlan, operationId: "other-operation" },
    { ...fixturePlan, target: { ...target, title: "different" } },
    { ...fixturePlan, target: { ...target, kind: "research-project" } },
    { ...fixturePlan, listId: "other-list" },
    { ...fixturePlan, expectedSnapshot: "0".repeat(64) },
    {
      ...fixturePlan,
      operation: { name: "complete", taskId: "fixture-decoy" },
    },
    {
      ...fixturePlan,
      operation: { name: "cancel", taskId: "fixture-original" },
    },
    { ...fixturePlan, policyVersion: "" },
    { ...fixturePlan, unknownField: true },
  ]) {
    const run = fixture({ plan });
    const result = await run.call("tasks_prepare_completion");
    assert.equal(result.isError, true);
    assert.equal(result.report?.code, "producer-plan-mismatch");
    assert.equal(result.report?.call, undefined);
  }
});

test("preparation refuses a valid timing plan the configured executor cannot send", async () => {
  const plan = {
    ...fixturePlan,
    timing: {
      schemaVersion: 1,
      planId: "fixture-timing",
      policyVersion: "fixture-policy",
      owner: "fixture-owner",
      observationDigest: "0".repeat(64),
      timeZone: "Asia/Singapore",
      placements: [],
      availability: { dated: [], weekly: [] },
    },
  };
  assert.ok(parseTaskExecutionPlan(plan).timing);
  const result = await fixture({ plan }).call("tasks_prepare_completion");
  assert.equal(result.isError, true);
  assert.equal(result.report?.code, "producer-plan-mismatch");
  assert.equal(result.report?.call, undefined);
});

test("structured producer refusal codes are preserved only when bounded and valid", async () => {
  for (const code of [
    "owner-state-stale",
    "authorization-revoked",
    "invalid\ncode",
    "x".repeat(101),
  ]) {
    const run = fixture({
      ready: false,
      refusal: { code, privateDetail: "never returned" },
    });
    const result = await run.call("tasks_prepare_completion");
    assert.equal(
      result.report?.code,
      code === "owner-state-stale" || code === "authorization-revoked"
        ? code
        : "producer-not-ready",
    );
    assert.equal(JSON.stringify(result).includes("never returned"), false);
  }
});

test("missing or mismatched guarded execution evidence refuses before producer discovery", async () => {
  for (const mutateObservation of [
    (value: OperationToolResult) => ({ ...value, report: {} }),
    (value: OperationToolResult) => {
      assert.ok(isJsonObject(value.report));
      assert.ok(isJsonObject(value.report.execution));
      return {
        ...value,
        report: {
          ...value.report,
          execution: {
            ...value.report.execution,
            target: { ...target, title: "wrong" },
          },
        },
      };
    },
    (value: OperationToolResult) => {
      assert.ok(isJsonObject(value.report));
      assert.ok(isJsonObject(value.report.execution));
      return {
        ...value,
        report: {
          ...value.report,
          execution: {
            ...value.report.execution,
            expectedSnapshot: "0".repeat(64),
          },
        },
      };
    },
  ]) {
    const run = fixture({ mutateObservation });
    assert.equal((await run.call("tasks_prepare_completion")).isError, true);
    assert.deepEqual(run.events, ["official-read"]);
  }
});
