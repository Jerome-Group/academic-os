import { GoogleAuth } from "google-auth-library";

import type {
  LiveTask,
  TaskList,
  TaskListReader,
  TaskListWriter,
  TaskRefreshReader,
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
  method: "GET" | "POST";
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
      await readPages<TaskList, TaskListPage>(async (pageToken) => {
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
      await readPages<LiveTask, TaskPage>(async (pageToken) => {
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

function taskCollectionUrl(listId: string): string {
  return `${tasksApiUrl}/lists/${encodeURIComponent(listId)}/tasks`;
}

async function readPages<
  TItem,
  TPage extends { items?: TItem[]; nextPageToken?: string },
>(
  readPage: (pageToken: string | undefined) => Promise<TPage>,
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
