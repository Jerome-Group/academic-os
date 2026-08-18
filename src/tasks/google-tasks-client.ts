import { GoogleAuth } from "google-auth-library";

import type {
  LiveTask,
  TaskList,
  TaskListReader,
  TaskListWriter,
  TaskRefreshReader,
  TaskOperationWriter,
} from "./types.js";

export const TASKS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/tasks.readonly";
export const TASKS_WRITE_SCOPE = "https://www.googleapis.com/auth/tasks";

const tasksApiUrl = "https://tasks.googleapis.com/tasks/v1";
const taskListsUrl = `${tasksApiUrl}/users/@me/lists`;

// `tasklists.list` pages at 1000 and `tasks.list` at 100; both are the documented maxima, so a
// module's list and its tasks each arrive in as few pages as the API allows.
const TASK_LIST_PAGE_SIZE = 1000;
const TASK_PAGE_SIZE = 100;

export interface TasksHttpRequest {
  url: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  params?: {
    maxResults?: number;
    pageToken?: string;
    showCompleted?: true;
    showDeleted?: true;
    showHidden?: true;
  };
  data?: Record<string, unknown>;
}

export interface TasksRequester {
  request<T>(request: TasksHttpRequest): Promise<{ data: T }>;
}

interface TaskListPage {
  items?: TaskList[];
  nextPageToken?: string;
}

interface TaskPage {
  items?: LiveTask[];
  nextPageToken?: string;
}

export function createGoogleTaskListReader(
  credentialPath: string,
  requester: TasksRequester = defaultRequester(
    credentialPath,
    TASKS_READONLY_SCOPE,
  ),
): TaskListReader {
  return {
    listTaskLists: async () =>
      await readPages<TaskList>(async (pageToken) => {
        const response: { data: TaskListPage } = await requester.request({
          url: taskListsUrl,
          method: "GET",
          params: {
            maxResults: TASK_LIST_PAGE_SIZE,
            ...(pageToken === undefined ? {} : { pageToken }),
          },
        });
        return response.data;
      }),
  };
}

export function createGoogleTaskListWriter(
  credentialPath: string,
  requester: TasksRequester = defaultRequester(
    credentialPath,
    TASKS_WRITE_SCOPE,
  ),
): TaskListWriter {
  return {
    createTaskList: async (title) => {
      const response: { data: { id?: string } } = await requester.request({
        url: taskListsUrl,
        method: "POST",
        data: { title },
      });
      if (typeof response.data.id !== "string" || response.data.id === "") {
        throw new Error(`Task-list creation returned no ID for ${title}.`);
      }
      return { id: response.data.id };
    },
  };
}

export function createGoogleTaskRefreshReader(
  credentialPath: string,
  requester: TasksRequester = defaultRequester(
    credentialPath,
    TASKS_READONLY_SCOPE,
  ),
): TaskRefreshReader {
  return {
    listTasks: async ({ listId }) =>
      // Completed tasks are hidden and a deletion is a flag rather than an absence, so a pull
      // that does not ask for all three cannot tell a tick from a task that never existed.
      await readPages<LiveTask>(async (pageToken) => {
        const response: { data: TaskPage } = await requester.request({
          url: taskCollectionUrl(listId),
          method: "GET",
          params: {
            maxResults: TASK_PAGE_SIZE,
            showCompleted: true,
            showDeleted: true,
            showHidden: true,
            ...(pageToken === undefined ? {} : { pageToken }),
          },
        });
        return response.data;
      }),
  };
}

export function createGoogleTaskOperationWriter(
  credentialPath: string,
  requester: TasksRequester = defaultRequester(
    credentialPath,
    TASKS_WRITE_SCOPE,
  ),
): TaskOperationWriter {
  return {
    createTask: async ({ listId, task }) => {
      const response: { data: { id?: string } } = await requester.request({
        url: taskCollectionUrl(listId),
        method: "POST",
        data: { ...task },
      });
      if (typeof response.data.id !== "string" || response.data.id === "") {
        throw new Error(`Task creation returned no ID for ${task.title}.`);
      }
      return { id: response.data.id };
    },
    patchTask: async ({ listId, taskId, patch }) => {
      await requester.request({
        url: taskUrl(listId, taskId),
        method: "PATCH",
        data: { ...patch },
      });
    },
    readTask: async ({ listId, taskId }) => {
      try {
        const response: { data: LiveTask } = await requester.request({
          url: taskUrl(listId, taskId),
          method: "GET",
        });
        return response.data;
      } catch (error) {
        // A task Google no longer has is the verified outcome of a cancel push, not a failure.
        if (isMissingTaskError(error)) return undefined;
        throw error;
      }
    },
    deleteTask: async ({ listId, taskId }) => {
      await requester.request({
        url: taskUrl(listId, taskId),
        method: "DELETE",
      });
    },
  };
}

function isMissingTaskError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; response?: { status?: unknown } };
  return value.code === 404 || value.response?.status === 404;
}

function taskUrl(listId: string, taskId: string): string {
  return `${taskCollectionUrl(listId)}/${encodeURIComponent(taskId)}`;
}

function taskCollectionUrl(listId: string): string {
  return `${tasksApiUrl}/lists/${encodeURIComponent(listId)}/tasks`;
}

async function readPages<TItem>(
  readPage: (
    pageToken: string | undefined,
  ) => Promise<{ items?: TItem[]; nextPageToken?: string }>,
): Promise<TItem[]> {
  const items: TItem[] = [];
  let pageToken: string | undefined;
  do {
    const page = await readPage(pageToken);
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);
  return items;
}

function defaultRequester(
  credentialPath: string,
  scope: string,
): TasksRequester {
  return new GoogleAuth({ keyFile: credentialPath, scopes: [scope] });
}
