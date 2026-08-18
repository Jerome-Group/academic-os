import { readFile, writeFile } from "node:fs/promises";

import { GoogleAuth } from "google-auth-library";

interface FakeTaskList {
  id: string;
  title: string;
}

interface FakeTasksState {
  lists: FakeTaskList[];
  listReadFailures?: string[];
  nextId?: number;
  taskPageSizes?: Record<string, number>;
  taskReadFailures?: string[];
  tasks?: Record<string, unknown[]>;
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

  const tasksMatch = options.url?.match(
    /^https:\/\/tasks\.googleapis\.com\/tasks\/v1\/lists\/([^/]+)\/tasks$/u,
  );
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
