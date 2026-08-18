import { readFile, writeFile } from "node:fs/promises";

import { GoogleAuth } from "google-auth-library";

interface FakeTaskList {
  id: string;
  title: string;
}

interface FakeTask {
  id: string;
  deleted?: boolean;
  [field: string]: unknown;
}

interface FakeTasksState {
  lists: FakeTaskList[];
  listReadFailures?: string[];
  nextId?: number;
  taskPageSizes?: Record<string, number>;
  taskReadFailures?: string[];
  taskWriteFailures?: string[];
  taskWritesIgnored?: string[];
  tasks?: Record<string, FakeTask[]>;
  requests?: Array<{
    body?: unknown;
    credential?: string;
    method?: string;
    scopes?: string[];
    params?: unknown;
    url?: string;
  }>;
}

interface RequestOptions {
  url?: string;
  method?: string;
  data?: unknown;
  params?: unknown;
}

interface GoogleAuthState {
  keyFilename?: string;
  scopes?: string | string[];
}

const statePath = process.env.ACADEMIC_OS_FAKE_TASKS_STATE;
if (statePath === undefined) {
  throw new Error("ACADEMIC_OS_FAKE_TASKS_STATE is required.");
}

const listsUrl = "https://tasks.googleapis.com/tasks/v1/users/@me/lists";

const prototype = GoogleAuth.prototype as unknown as {
  request(
    this: GoogleAuthState,
    options: RequestOptions,
  ): Promise<{ data: unknown }>;
};

prototype.request = async function (options) {
  const state = JSON.parse(await readFile(statePath, "utf8")) as FakeTasksState;
  state.requests = [
    ...(state.requests ?? []),
    {
      ...(options.data === undefined ? {} : { body: options.data }),
      ...(this.keyFilename === undefined
        ? {}
        : { credential: this.keyFilename }),
      method: options.method ?? "GET",
      ...(options.params === undefined ? {} : { params: options.params }),
      scopes:
        typeof this.scopes === "string" ? [this.scopes] : (this.scopes ?? []),
      ...(options.url === undefined ? {} : { url: options.url }),
    },
  ];
  // Every request is recorded before it can fail, so a parked operation is still readable at the
  // seam as a push that was attempted.
  await writeFile(statePath, `${JSON.stringify(state)}\n`);

  if (options.method === "GET" && options.url === listsUrl) {
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    if (state.listReadFailures?.includes("lists") === true) {
      throw new Error("Synthetic task-list read failed.");
    }
    return { data: { items: state.lists } };
  }

  if (options.method === "POST" && options.url === listsUrl) {
    const body = options.data as { title?: string };
    const list = {
      id: `created-${state.nextId ?? 1}`,
      title: body.title ?? "",
    };
    state.nextId = (state.nextId ?? 1) + 1;
    state.lists.push(list);
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: list };
  }

  const taskMatch = options.url?.match(
    /^https:\/\/tasks\.googleapis\.com\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)$/u,
  );
  if (taskMatch !== null && taskMatch !== undefined) {
    const listId = decodeURIComponent(taskMatch[1] ?? "");
    const taskId = decodeURIComponent(taskMatch[2] ?? "");
    const task = state.tasks?.[listId]?.find(({ id }) => id === taskId);
    if (options.method === "GET") {
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      if (task === undefined) throw missingTask(taskId);
      return { data: task };
    }
    refuseWriteFailure(state, [listId, taskId]);
    if (task === undefined) throw missingTask(taskId);
    if (options.method === "PATCH") {
      if (state.taskWritesIgnored?.includes(taskId) !== true) {
        Object.assign(task, options.data);
      }
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      return { data: task };
    }
    if (options.method === "DELETE") {
      task.deleted = true;
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      return { data: {} };
    }
  }

  const tasksMatch = options.url?.match(
    /^https:\/\/tasks\.googleapis\.com\/tasks\/v1\/lists\/([^/]+)\/tasks$/u,
  );
  if (
    options.method === "POST" &&
    tasksMatch !== null &&
    tasksMatch !== undefined
  ) {
    const listId = decodeURIComponent(tasksMatch[1] ?? "");
    refuseWriteFailure(state, [listId]);
    const task: FakeTask = {
      id: `created-${state.nextId ?? 1}`,
      status: "needsAction",
      ...(options.data as Record<string, unknown>),
    };
    state.nextId = (state.nextId ?? 1) + 1;
    state.tasks = {
      ...state.tasks,
      [listId]: [...(state.tasks?.[listId] ?? []), task],
    };
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: task };
  }
  if (
    options.method === "GET" &&
    tasksMatch !== null &&
    tasksMatch !== undefined
  ) {
    const listId = decodeURIComponent(tasksMatch[1] ?? "");
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    if (state.taskReadFailures?.includes(listId) === true) {
      throw new Error(`Synthetic task read failed for ${listId}.`);
    }
    const tasks = state.tasks?.[listId] ?? [];
    const params = options.params as { pageToken?: string } | undefined;
    const offset = Number(params?.pageToken ?? "0");
    const pageSize = state.taskPageSizes?.[listId] ?? tasks.length;
    const nextOffset = offset + Math.max(pageSize, 1);
    return {
      data: {
        items: tasks.slice(offset, nextOffset),
        ...(nextOffset < tasks.length
          ? { nextPageToken: String(nextOffset) }
          : {}),
      },
    };
  }

  throw new Error(`Unexpected synthetic Tasks request: ${options.url}.`);
};

function refuseWriteFailure(state: FakeTasksState, keys: string[]): void {
  const refused = keys.find(
    (key) => state.taskWriteFailures?.includes(key) === true,
  );
  if (refused !== undefined) {
    throw new Error(`Synthetic task write failed for ${refused}.`);
  }
}

function missingTask(taskId: string): Error {
  return Object.assign(new Error(`No synthetic task ${taskId}.`), {
    code: 404,
  });
}
