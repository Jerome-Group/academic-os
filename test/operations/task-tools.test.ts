import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTaskTools,
  type TaskToolPort,
} from "../../src/operations/index.js";
import type { OperationTool } from "../../src/operations/index.js";
import type {
  TaskOperationReport,
  TaskRegisterReadReport,
} from "../../src/tasks/index.js";
import {
  createFakeTaskList,
  createInMemoryTaskRegisterStore,
  type FakeTaskList,
  type InMemoryTaskRegisterStore,
} from "../support/fake-task-list.js";

interface Fixture {
  tools: Map<string, OperationTool>;
  list: FakeTaskList;
  store: InMemoryTaskRegisterStore;
}

function setupFixture(): Fixture {
  const list = createFakeTaskList({
    listId: "module-list",
    tasks: [
      {
        id: "mirrored",
        title: "Read chapter",
        due: "2026-08-21T00:00:00.000Z",
        status: "needsAction",
      },
    ],
  });
  const store = createInMemoryTaskRegisterStore({
    listId: "module-list",
    tasks: [
      {
        taskId: "mirrored",
        title: "Read chapter",
        doDate: "2026-08-21",
        status: "open",
        provenance: { assessment: "Midterm" },
      },
    ],
  });
  const port: TaskToolPort = {
    target: ({ semester, module }) => {
      if (semester !== "Y2S1" || module !== "MODULE") {
        throw new Error(
          `Module ${module} is not mapped to semester ${semester}.`,
        );
      }
      return { semester, module, registerStore: store };
    },
    writer: list.writer,
    reader: list.reader,
  };
  return {
    tools: new Map(createTaskTools(port).map((tool) => [tool.name, tool])),
    list,
    store,
  };
}

function call(
  fixture: Fixture,
  name: string,
  values: Record<string, string>,
): Promise<{ report: unknown; failed: boolean }> {
  const tool = fixture.tools.get(name);
  assert.ok(tool !== undefined, `${name} is not a served tool`);
  return tool.call(
    new Map(Object.entries({ semester: "Y2S1", module: "MODULE", ...values })),
  );
}

describe("the served task tools", () => {
  it("serves exactly the v1 surface", () => {
    assert.deepEqual(
      [...setupFixture().tools.keys()],
      ["tasks_create", "tasks_change", "tasks_complete", "tasks_read_register"],
    );
  });

  it("pushes a created task to the live list, then refreshes the register", async () => {
    const fixture = setupFixture();

    const { report, failed } = await call(fixture, "tasks_create", {
      title: "Attempt tutorial 3",
      do_date: "2026-08-27",
      notes: "Deadline Friday",
      assessment: "Quiz 2",
    });

    assert.equal(failed, false);
    const operation = report as TaskOperationReport;
    assert.equal(operation.command, "tasks create");
    assert.equal(operation.outcome, "applied");
    assert.deepEqual(operation.module, { semester: "Y2S1", module: "MODULE" });
    assert.equal(operation.taskId, "created-1");
    assert.equal(operation.register?.freshness, "fresh");
    assert.deepEqual(
      fixture.list.tasks().find(({ id }) => id === "created-1"),
      {
        id: "created-1",
        status: "needsAction",
        title: "Attempt tutorial 3",
        due: "2026-08-27T00:00:00.000Z",
        notes: "Deadline Friday",
      },
    );
    assert.deepEqual(fixture.store.current()?.tasks.at(-1), {
      taskId: "created-1",
      title: "Attempt tutorial 3",
      doDate: "2026-08-27",
      status: "open",
      notes: "Deadline Friday",
      provenance: { assessment: "Quiz 2" },
    });
  });

  it("parks a push the live list refuses and leaves the register without a row", async () => {
    const fixture = setupFixture();
    fixture.list.refuseWrites();

    const { report, failed } = await call(fixture, "tasks_create", {
      title: "Attempt tutorial 3",
    });

    assert.equal(failed, true);
    const operation = report as TaskOperationReport;
    assert.equal(operation.outcome, "parked");
    assert.equal(operation.taskId, null);
    assert.equal(operation.failure?.code, "operational-failure");
    assert.equal(fixture.store.current()?.tasks.length, 1);
    assert.equal(fixture.list.tasks().length, 1);
  });

  it("changes a task's do-date on the live list and mirrors it back", async () => {
    const fixture = setupFixture();

    const { report, failed } = await call(fixture, "tasks_change", {
      task_id: "mirrored",
      do_date: "2026-08-28",
    });

    assert.equal(failed, false);
    assert.equal((report as TaskOperationReport).outcome, "applied");
    assert.equal(fixture.list.tasks()[0]?.due, "2026-08-28T00:00:00.000Z");
    assert.equal(fixture.store.current()?.tasks[0]?.doDate, "2026-08-28");
  });

  it("refuses a do-date carrying a time rather than truncating it", async () => {
    const fixture = setupFixture();

    await assert.rejects(
      call(fixture, "tasks_change", {
        task_id: "mirrored",
        do_date: "2026-08-28T09:00",
      }),
      /date with no time/u,
    );
    assert.equal(fixture.store.current()?.tasks[0]?.doDate, "2026-08-21");
  });

  it("refuses a change that names nothing to change", async () => {
    await assert.rejects(
      call(setupFixture(), "tasks_change", { task_id: "mirrored" }),
      /at least one of title, do_date or notes/u,
    );
  });

  it("ticks a task on the live list and completes its register row", async () => {
    const fixture = setupFixture();

    const { failed } = await call(fixture, "tasks_complete", {
      task_id: "mirrored",
    });

    assert.equal(failed, false);
    assert.equal(fixture.list.tasks()[0]?.status, "completed");
    assert.equal(fixture.store.current()?.tasks[0]?.status, "completed");
  });

  it("reads the register by pulling the live list first, keeping provenance", async () => {
    const fixture = setupFixture();
    await fixture.list.writer.createTask({
      listId: "module-list",
      task: { title: "Added on the phone", due: "2026-08-30T00:00:00.000Z" },
    });

    const { report, failed } = await call(fixture, "tasks_read_register", {});

    assert.equal(failed, false);
    const read = report as TaskRegisterReadReport;
    assert.equal(read.command, "tasks read-register");
    assert.equal(read.outcome, "read");
    assert.equal(read.register.freshness, "fresh");
    assert.deepEqual(read.register.changes, {
      added: 1,
      updated: 0,
      cancelled: 0,
    });
    assert.deepEqual(read.tasks, [
      {
        taskId: "mirrored",
        title: "Read chapter",
        doDate: "2026-08-21",
        status: "open",
        provenance: { assessment: "Midterm" },
      },
      {
        taskId: "created-1",
        title: "Added on the phone",
        doDate: "2026-08-30",
        status: "open",
      },
    ]);
  });

  it("reports a register it could not pull as stale rather than as read", async () => {
    const fixture = setupFixture();
    fixture.list.refuseReads();

    const { report, failed } = await call(fixture, "tasks_read_register", {});

    assert.equal(failed, true);
    const read = report as TaskRegisterReadReport;
    assert.equal(read.outcome, "stale");
    assert.equal(read.register.failure?.code, "operational-failure");
    assert.equal(read.tasks.length, 1);
  });

  it("fails visibly when the module is not one the mini configures", async () => {
    await assert.rejects(
      call(setupFixture(), "tasks_read_register", { module: "OTHER" }),
      /not mapped to semester/u,
    );
  });
});
