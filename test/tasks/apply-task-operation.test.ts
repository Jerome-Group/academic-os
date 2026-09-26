import assert from "node:assert/strict";
import { it } from "node:test";

import { applyTaskTargetOperation } from "../../src/tasks/apply-task-operation.js";
import type {
  TaskOperation,
  TaskOperationWriter,
  TaskRegisterTarget,
} from "../../src/tasks/index.js";

const target: TaskRegisterTarget = {
  identity: { kind: "module", key: "test-module", title: "Test module" },
  registerStore: {
    read: async () => ({
      listId: "list",
      tasks: [{ taskId: "known-task", title: "Existing", status: "open" }],
    }),
    write: async () => {},
  },
};
const writer: TaskOperationWriter = {
  createTask: async () => ({ id: "created-task" }),
  patchTask: async () => {},
  deleteTask: async () => {},
  readTask: async () => {
    throw new Error("Readback unavailable.");
  },
};

it("preserves a successful push's ID when create, patch or cancellation verification cannot read", async () => {
  const operations: TaskOperation[] = [
    { name: "create", title: "Created" },
    { name: "change", taskId: "known-task", title: "Changed" },
    { name: "complete", taskId: "known-task" },
    { name: "cancel", taskId: "known-task" },
  ];
  for (const operation of operations) {
    const result = await applyTaskTargetOperation({
      target,
      operation,
      writer,
      reader: { listTasks: async () => [] },
    });
    assert.equal(result.outcome, "unverified");
    assert.equal(
      result.taskId,
      operation.name === "create" ? "created-task" : "known-task",
    );
    assert.match(result.failure?.message ?? "", /could not be read after/u);
  }
});

it("reports a verified create as applied with its ID when saving the register fails", async () => {
  const result = await applyTaskTargetOperation({
    target: {
      ...target,
      registerStore: {
        ...target.registerStore,
        write: async () => {
          throw new Error("Register changed after read.");
        },
      },
    },
    operation: {
      name: "create",
      title: "Created",
      provenance: { source: "source" },
    },
    writer: {
      ...writer,
      readTask: async () => ({ id: "created-task", title: "Created" }),
    },
    reader: { listTasks: async () => [] },
  });
  assert.equal(result.outcome, "applied");
  assert.equal(result.taskId, "created-task");
  assert.equal(result.register, null);
  assert.ok(result.failure);
});

it("keeps ambiguous applied-then-throw writes unverified with any known ID", async () => {
  for (const error of [
    new Error("Timeout"),
    { response: { status: 503 } },
    { response: { status: 408 } },
    { response: { status: 429 } },
  ]) {
    for (const operation of [
      { name: "create", title: "Created" },
      { name: "change", taskId: "known-task", title: "Changed" },
      { name: "cancel", taskId: "known-task" },
    ] as TaskOperation[]) {
      let applied = false;
      let localWrites = 0;
      const failAfterWrite = async (): Promise<never> => {
        applied = true;
        throw error;
      };
      const result = await applyTaskTargetOperation({
        target: {
          ...target,
          registerStore: {
            ...target.registerStore,
            write: async () => {
              localWrites++;
            },
          },
        },
        operation,
        writer: {
          ...writer,
          createTask: failAfterWrite,
          patchTask: failAfterWrite,
          deleteTask: failAfterWrite,
        },
        reader: { listTasks: async () => [] },
      });
      assert.equal(applied, true);
      assert.equal(result.outcome, "unverified");
      assert.equal(
        result.taskId,
        operation.name === "create" ? null : "known-task",
      );
      assert.equal(localWrites, 0);
      assert.equal(JSON.parse(JSON.stringify(result)).taskId, result.taskId);
    }
  }
});

it("keeps a create with no returned ID unverified", async () => {
  const result = await applyTaskTargetOperation({
    target,
    operation: { name: "create", title: "Created" },
    writer: { ...writer, createTask: async () => ({ id: "" }) },
    reader: { listTasks: async () => [] },
  });
  assert.equal(result.outcome, "unverified");
  assert.equal(result.taskId, null);
});

it("parks definitive rejections and validation failures before writes", async () => {
  let writes = 0;
  const rejectingWriter: TaskOperationWriter = {
    ...writer,
    createTask: async () => {
      writes++;
      throw { response: { status: 403 } };
    },
  };
  for (const operation of [
    { name: "create", title: "Rejected" },
    { name: "cancel", taskId: "unknown-task" },
  ] as TaskOperation[]) {
    const result = await applyTaskTargetOperation({
      target,
      operation,
      writer: rejectingWriter,
      reader: { listTasks: async () => [] },
    });
    assert.equal(result.outcome, "parked");
    assert.equal(result.taskId, null);
  }
  assert.equal(writes, 1);
});
