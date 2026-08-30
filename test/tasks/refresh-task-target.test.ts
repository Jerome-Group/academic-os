import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  refreshTaskTarget,
  type TaskRegister,
  type TaskRegisterStore,
} from "../../src/tasks/index.js";

describe("Task-register refresh", () => {
  it("refreshes a research-project target through the shared pull-only kernel", async () => {
    let register: TaskRegister | undefined = {
      listId: "research-list",
      tasks: [],
    };
    const store: TaskRegisterStore = {
      read: async () => register,
      write: async (next) => {
        register = next;
      },
    };

    const report = await refreshTaskTarget(
      {
        identity: {
          kind: "research-project",
          key: "ureca-y2",
          title: "URECA Y2",
        },
        registerStore: store,
      },
      {
        listTasks: async ({ listId }) => {
          assert.equal(listId, "research-list");
          return [
            {
              id: "reading",
              title: "Read the first paper",
              status: "needsAction",
            },
          ];
        },
      },
    );

    assert.deepEqual(report, {
      target: {
        kind: "research-project",
        key: "ureca-y2",
        title: "URECA Y2",
      },
      freshness: "fresh",
      listId: "research-list",
      counts: {
        tasks: 1,
        open: 1,
        completed: 0,
        cancelled: 0,
        unpushed: 0,
      },
      changes: { added: 1, updated: 0, cancelled: 0 },
    });
    assert.deepEqual(register?.tasks, [
      {
        taskId: "reading",
        title: "Read the first paper",
        status: "open",
      },
    ]);
  });
});
