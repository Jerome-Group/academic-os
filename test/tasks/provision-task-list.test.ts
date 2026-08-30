import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  provisionTaskList,
  type TaskRegister,
  type TaskRegisterStore,
} from "../../src/tasks/index.js";

describe("Task-list provisioning", () => {
  it("provisions the exact list title carried by a research-project target", async () => {
    let register: TaskRegister | undefined = { tasks: [] };
    const store: TaskRegisterStore = {
      read: async () => register,
      write: async (next) => {
        register = next;
      },
    };
    const created: string[] = [];

    const report = await provisionTaskList({
      target: {
        kind: "research-project",
        key: "ureca-y2",
        title: "URECA Y2",
      },
      reader: { listTaskLists: async () => [] },
      writer: {
        createTaskList: async (title) => {
          created.push(title);
          return { id: "research-list" };
        },
      },
      registerStore: store,
      apply: true,
    });

    assert.deepEqual(created, ["URECA Y2"]);
    assert.deepEqual(register, { listId: "research-list", tasks: [] });
    assert.deepEqual(report, {
      target: {
        kind: "research-project",
        key: "ureca-y2",
        title: "URECA Y2",
      },
      outcome: "provisioned",
      list: {
        title: "URECA Y2",
        action: "created",
        listId: "research-list",
      },
      register: "written",
    });
  });
});
