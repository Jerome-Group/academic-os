import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createGoogleTaskRefreshReader,
  refreshTaskTarget,
  type TaskRegister,
  type TasksHttpRequest,
} from "../../src/tasks/index.js";

it("preserves the Task register after cycling pagination and recovers on a complete retry", async () => {
  const original: TaskRegister = {
    listId: "synthetic-list",
    tasks: [{ taskId: "existing", title: "Synthetic task", status: "open" }],
  };
  let current = original;
  let cycling = true;
  let calls = 0;
  const reader = createGoogleTaskRefreshReader("/private/synthetic", {
    request: async <T>() => {
      calls += 1;
      if (calls > 3) throw new Error("fixture loop limit");
      return {
        data: {
          items: [
            { id: "existing", title: "Synthetic task", status: "needsAction" },
          ],
          ...(cycling ? { nextPageToken: "repeat" } : {}),
        } as T,
      };
    },
  });
  const target = {
    identity: { kind: "module" as const, key: "synthetic", title: "AB1234" },
    registerStore: {
      read: async () => current,
      write: async (value: TaskRegister) => {
        current = value;
      },
    },
  };
  const failed = await refreshTaskTarget(target, reader);
  assert.equal(failed.freshness, "stale");
  assert.equal(current, original);
  assert.equal(calls, 2);
  cycling = false;
  assert.equal((await refreshTaskTarget(target, reader)).freshness, "fresh");
  assert.deepEqual(current, original);
});

it("retains an existing assigned task when the complete visibility query includes it", async () => {
  let current: TaskRegister = {
    listId: "fixture-list",
    tasks: [
      { taskId: "assigned-task", title: "Fixture assignment", status: "open" },
    ],
  };
  const reader = createGoogleTaskRefreshReader("/private/synthetic", {
    request: async <T>({ params }: TasksHttpRequest): Promise<{ data: T }> => ({
      data: {
        items:
          params?.showAssigned === true
            ? [
                {
                  id: "assigned-task",
                  title: "Fixture assignment",
                  status: "needsAction",
                },
              ]
            : [],
      } as T,
    }),
  });
  const report = await refreshTaskTarget(
    {
      identity: { kind: "module", key: "fixture", title: "Fixture" },
      registerStore: {
        read: async () => structuredClone(current),
        write: async (value) => {
          current = value;
        },
      },
    },
    reader,
  );
  assert.equal(report.freshness, "fresh");
  assert.equal(current.tasks[0]?.status, "open");
  assert.equal(report.changes.cancelled, 0);
});
