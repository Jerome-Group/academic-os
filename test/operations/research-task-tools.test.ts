import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTaskTools,
  type OperationTool,
  type TaskToolPort,
} from "../../src/operations/index.js";
import type { TaskTargetOperationReport } from "../../src/tasks/index.js";
import {
  createFakeTaskList,
  createInMemoryTaskRegisterStore,
} from "../support/fake-task-list.js";

describe("the served research-project task tools", () => {
  it("creates a research task through its target identity and shared live-list boundary", async () => {
    const list = createFakeTaskList({ listId: "research-list", tasks: [] });
    const store = createInMemoryTaskRegisterStore({
      listId: "research-list",
      tasks: [],
    });
    const port: TaskToolPort = {
      target: () => {
        throw new Error("the module adapter was not selected");
      },
      researchProjectTarget: (key) => ({
        identity: { kind: "research-project", key, title: "URECA Y2" },
        registerStore: store,
      }),
      writer: list.writer,
      reader: list.reader,
    };
    const tools = new Map<string, OperationTool>(
      createTaskTools(port).map((tool) => [tool.name, tool]),
    );

    assert.deepEqual(
      [...tools.keys()].filter((name) => name.startsWith("research_tasks_")),
      [
        "research_tasks_create",
        "research_tasks_change",
        "research_tasks_complete",
        "research_tasks_read_register",
      ],
    );
    const create = tools.get("research_tasks_create");
    assert.ok(create !== undefined);
    assert.deepEqual(
      create.fields.slice(0, 1).map(({ name, required }) => ({
        name,
        required,
      })),
      [{ name: "research_project", required: true }],
    );
    assert.deepEqual(
      create.fields
        .map(({ name }) => name)
        .filter((name) => ["claim", "meeting", "deliverable"].includes(name)),
      ["claim", "meeting", "deliverable"],
    );

    const { report, failed } = await create.call(
      new Map([
        ["research_project", "ureca-y2"],
        ["title", "Read the first paper"],
        ["do_date", "2026-09-07"],
        ["claim", "C-01"],
        ["meeting", "2026-09-01 supervisor meeting"],
        ["deliverable", "URECA paper"],
      ]),
    );

    assert.equal(failed, false);
    const operation = report as TaskTargetOperationReport;
    assert.deepEqual(operation.target, {
      kind: "research-project",
      key: "ureca-y2",
      title: "URECA Y2",
    });
    assert.equal(operation.outcome, "applied");
    assert.deepEqual(store.current()?.tasks, [
      {
        taskId: "created-1",
        title: "Read the first paper",
        doDate: "2026-09-07",
        status: "open",
        provenance: {
          claim: "C-01",
          meeting: "2026-09-01 supervisor meeting",
          deliverable: "URECA paper",
        },
      },
    ]);

    const read = tools.get("research_tasks_read_register");
    assert.ok(read !== undefined);
    const readResult = await read.call(
      new Map([["research_project", "ureca-y2"]]),
    );
    assert.equal(readResult.failed, false);
    assert.equal((readResult.report as { tasks: unknown[] }).tasks.length, 1);
  });
});
