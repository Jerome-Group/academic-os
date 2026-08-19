import type {
  LiveTask,
  TaskOperationWriter,
  TaskRefreshReader,
  TaskRegister,
  TaskRegisterStore,
} from "../../src/tasks/index.js";

export interface FakeTaskList {
  writer: TaskOperationWriter;
  reader: TaskRefreshReader;
  tasks(): LiveTask[];
  refuseWrites(): void;
  refuseReads(): void;
  ignoreWrites(): void;
}

// One module's live list, in memory: the same seam the Google client sits behind, so a tool call
// is exercised against what Google would do rather than against how it is reached.
export function createFakeTaskList(input: {
  listId: string;
  tasks?: LiveTask[];
}): FakeTaskList {
  const tasks = [...(input.tasks ?? [])];
  let nextId = 1;
  let writesRefused = false;
  let readsRefused = false;
  let writesIgnored = false;

  const find = (taskId: string): LiveTask | undefined =>
    tasks.find(({ id }) => id === taskId);
  const assertList = (listId: string): void => {
    if (listId !== input.listId) throw new Error(`No list ${listId}.`);
  };
  const assertWritable = (): void => {
    if (writesRefused) throw new Error("Synthetic task write failed.");
  };

  return {
    tasks: () => tasks.map((task) => ({ ...task })),
    refuseWrites: () => {
      writesRefused = true;
    },
    refuseReads: () => {
      readsRefused = true;
    },
    ignoreWrites: () => {
      writesIgnored = true;
    },
    writer: {
      createTask: async ({ listId, task }) => {
        assertList(listId);
        assertWritable();
        const created: LiveTask = {
          id: `created-${nextId}`,
          status: "needsAction",
          ...(writesIgnored ? { title: task.title } : task),
        };
        nextId += 1;
        tasks.push(created);
        return { id: created.id };
      },
      patchTask: async ({ listId, taskId, patch }) => {
        assertList(listId);
        assertWritable();
        const task = find(taskId);
        if (task === undefined) throw new Error(`No task ${taskId}.`);
        if (!writesIgnored) Object.assign(task, patch);
      },
      readTask: async ({ listId, taskId }) => {
        assertList(listId);
        const task = find(taskId);
        return task === undefined ? undefined : { ...task };
      },
      deleteTask: async ({ listId, taskId }) => {
        assertList(listId);
        assertWritable();
        const task = find(taskId);
        if (task === undefined) throw new Error(`No task ${taskId}.`);
        task.deleted = true;
      },
    },
    reader: {
      listTasks: async ({ listId }) => {
        assertList(listId);
        if (readsRefused) throw new Error("Synthetic task read failed.");
        return tasks.map((task) => ({ ...task }));
      },
    },
  };
}

export interface InMemoryTaskRegisterStore extends TaskRegisterStore {
  current(): TaskRegister | undefined;
}

export function createInMemoryTaskRegisterStore(
  register?: TaskRegister,
): InMemoryTaskRegisterStore {
  let held = register;
  return {
    read: async () => (held === undefined ? undefined : structuredClone(held)),
    write: async (next) => {
      held = structuredClone(next);
    },
    current: () => (held === undefined ? undefined : structuredClone(held)),
  };
}
