import assert from "node:assert/strict";
import { test } from "node:test";
import { guardedTaskTools } from "../../src/operations/task-plan-tools.js";
import type { OperationTool } from "../../src/operations/types.js";

test("production legacy mutations cannot bypass exact-plan execution", async () => {
  let oldWrites = 0;
  const tools: OperationTool[] = [
    "tasks_create",
    "tasks_change",
    "tasks_complete",
    "research_tasks_create",
    "research_tasks_change",
    "research_tasks_complete",
  ].map((name) => ({
    name,
    title: name,
    description: name,
    fields: [],
    call: async () => {
      oldWrites++;
      return { failed: false, report: {} };
    },
  }));
  const guarded = guardedTaskTools(tools, {
    apply: async () => {
      throw Error("not called");
    },
  });
  for (const tool of guarded.filter(
    (tool) =>
      tool.name !== "tasks_apply_plan" &&
      tool.name !== "tasks_sync_capabilities",
  )) {
    const result = await tool.call(new Map());
    assert.equal(result.failed, true);
    assert.equal(
      (result.report as { code: string }).code,
      "exact-plan-required",
    );
  }
  assert.equal(oldWrites, 0);
});

test("both client identities submit the same exact plan and receive live conflicts unchanged", async () => {
  const received: unknown[] = [];
  const tools = guardedTaskTools([], {
    apply: async (plan) => {
      received.push(plan);
      return {
        schemaVersion: 1,
        operationId: "fixture-op",
        taskId: null,
        registerFresh: false,
        outcome: "conflict",
        code: "snapshot-changed",
      };
    },
  });
  const tool = tools.find((tool) => tool.name === "tasks_apply_plan");
  assert.ok(tool);
  const plan = { schemaVersion: 1, opaque: "exact supplied fixture" };
  for (const _client of ["emmy", "module"]) {
    const result = await tool.call(
      new Map([["plan_json", JSON.stringify(plan)]]),
    );
    assert.equal(result.failed, true);
    assert.equal((result.report as { code: string }).code, "snapshot-changed");
  }
  assert.deepEqual(received, [plan, plan]);
  await assert.rejects(
    tool.call(new Map([["plan_json", "{invalid"]])),
    /valid JSON/u,
  );
  await assert.rejects(tool.call(new Map()), /required/u);
});

test("all current module and research MCP callers can obtain a snapshot and use their existing operation name safely", async () => {
  for (const prefix of ["tasks", "research_tasks"]) {
    const isResearch = prefix === "research_tasks";
    const target = isResearch
      ? {
          kind: "research-project",
          key: "fixture-project",
          title: "Fixture research",
        }
      : { kind: "module", key: "FIXTURE/MOD1", title: "MOD1" };
    const fields = isResearch
      ? [["research_project", "fixture-project"]]
      : [
          ["semester", "FIXTURE"],
          ["module", "MOD1"],
        ];
    const received: unknown[] = [];
    const tools: OperationTool[] = [
      {
        name: `${prefix}_read_register`,
        title: "read",
        description: "read",
        fields: [],
        call: async () => ({
          failed: false,
          report: {
            ...(isResearch
              ? { target }
              : { module: { semester: "FIXTURE", module: "MOD1" } }),
            register: {
              freshness: "fresh",
              listId: "fixture-list",
              providerSnapshot: "a".repeat(64),
            },
            tasks: [],
          },
        }),
      },
      ...["create", "change", "complete"].map(
        (operation): OperationTool => ({
          name: `${prefix}_${operation}`,
          title: operation,
          description: operation,
          fields: [],
          call: async () => {
            throw new Error("legacy unsafe kernel must not be reached");
          },
        }),
      ),
    ];
    const guarded = guardedTaskTools(tools, {
      apply: async (plan) => {
        received.push(plan);
        return {
          schemaVersion: 1,
          operationId: "fixture-op",
          taskId: "task-1",
          registerFresh: true,
          outcome: "applied",
        };
      },
    });
    const catalog = await guarded
      .find((tool) => tool.name === "tasks_sync_capabilities")
      ?.call(new Map());
    assert.ok(catalog);
    assert.equal(
      (catalog.report as { protocol: string }).protocol,
      "task-plan/1",
    );
    const read = await guarded
      .find((tool) => tool.name === `${prefix}_read_register`)
      ?.call(new Map(fields as [string, string][]));
    assert.ok(read);
    const execution = (
      read.report as {
        execution: {
          expectedSnapshot: string;
          target: unknown;
          listId: string;
        };
      }
    ).execution;
    assert.deepEqual(execution.target, target);
    for (const name of ["create", "change", "complete"]) {
      const operation =
        name === "create"
          ? { name, title: "Fixture" }
          : name === "change"
            ? { name, taskId: "task-1", title: "Fixture" }
            : { name, taskId: "task-1" };
      const plan = {
        schemaVersion: 1,
        operationId: `fixture-${name}`,
        ...execution,
        operation,
        sourceOccurrenceId: "fixture-occurrence",
        policyVersion: "fixture-policy",
      };
      // Only envelope fields are sent back; the negotiation's descriptive metadata is not part of a plan.
      const exact = {
        schemaVersion: 1,
        operationId: plan.operationId,
        target,
        listId: execution.listId,
        expectedSnapshot: execution.expectedSnapshot,
        operation,
        sourceOccurrenceId: plan.sourceOccurrenceId,
        policyVersion: plan.policyVersion,
      };
      const result = await guarded
        .find((tool) => tool.name === `${prefix}_${name}`)
        ?.call(
          new Map([
            ...(fields as [string, string][]),
            ["plan_json", JSON.stringify(exact)],
            ...(name === "create"
              ? [["title", "Fixture"] as [string, string]]
              : [["task_id", "task-1"] as [string, string]]),
          ]),
        );
      assert.equal(result?.failed, false);
    }
    assert.equal(received.length, 3);
  }
});

test("compatibility calls refuse provenance disagreement instead of silently changing source metadata", async () => {
  let writes = 0;
  const legacy: OperationTool = {
    name: "tasks_create",
    title: "create",
    description: "create",
    fields: [],
    call: async () => {
      throw Error("unsafe");
    },
  };
  const tool = guardedTaskTools([legacy], {
    apply: async () => {
      writes++;
      return {
        schemaVersion: 1,
        operationId: "fixture",
        taskId: "task",
        outcome: "applied",
        registerFresh: true,
      };
    },
  }).find((tool) => tool.name === "tasks_create");
  assert.ok(tool);
  const plan = {
    schemaVersion: 1,
    operationId: "fixture",
    target: { kind: "module", key: "Y2S1/MH2100", title: "MH2100" },
    listId: "list",
    expectedSnapshot: "a".repeat(64),
    sourceOccurrenceId: "source",
    policyVersion: "fixture",
    operation: {
      name: "create",
      title: "Fixture",
      provenance: { source: "B" },
    },
  };
  await assert.rejects(
    tool.call(
      new Map([
        ["semester", "Y2S1"],
        ["module", "MH2100"],
        ["title", "Fixture"],
        ["source", "A"],
        ["plan_json", JSON.stringify(plan)],
      ]),
    ),
    /must match/u,
  );
  assert.equal(writes, 0);
});
