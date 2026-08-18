import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGoogleTaskListReader,
  createGoogleTaskListWriter,
  createGoogleTaskRefreshReader,
  type TasksHttpRequest,
  type TasksRequester,
} from "../../src/tasks/index.js";

describe("Google Tasks adapter", () => {
  it("pages task lists and creates one from its exact title", async () => {
    const requests: TasksHttpRequest[] = [];
    const requester: TasksRequester = {
      request: async <T>(request: TasksHttpRequest) => {
        requests.push(request);
        if (request.method === "POST") return { data: { id: "created" } as T };
        return {
          data: (request.params?.pageToken === undefined
            ? { items: [{ id: "first", title: "MH2100" }], nextPageToken: "2" }
            : { items: [{ id: "second", title: "MH2101" }] }) as T,
        };
      },
    };
    const reader = createGoogleTaskListReader("/private/read", requester);
    const writer = createGoogleTaskListWriter("/private/write", requester);

    assert.deepEqual(await reader.listTaskLists(), [
      { id: "first", title: "MH2100" },
      { id: "second", title: "MH2101" },
    ]);
    assert.deepEqual(await writer.createTaskList("MH2100"), { id: "created" });
    assert.deepEqual(
      requests.map(({ url, method, params, data }) => ({
        url,
        method,
        pageToken: params?.pageToken,
        data,
      })),
      [
        {
          url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
          method: "GET",
          pageToken: undefined,
          data: undefined,
        },
        {
          url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
          method: "GET",
          pageToken: "2",
          data: undefined,
        },
        {
          url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
          method: "POST",
          pageToken: undefined,
          data: { title: "MH2100" },
        },
      ],
    );
  });

  it("refuses a created list the provider gave no ID for", async () => {
    const writer = createGoogleTaskListWriter("/private/write", {
      request: async <T>() => ({ data: {} as T }),
    });

    await assert.rejects(
      async () => await writer.createTaskList("MH2100"),
      /returned no ID/u,
    );
  });

  it("reads completed, hidden and deleted tasks across every page", async () => {
    const requests: TasksHttpRequest[] = [];
    const requester: TasksRequester = {
      request: async <T>(request: TasksHttpRequest) => {
        requests.push(request);
        return {
          data: (request.params?.pageToken === undefined
            ? { items: [{ id: "open" }], nextPageToken: "2" }
            : { items: [{ id: "gone", deleted: true }] }) as T,
        };
      },
    };
    const reader = createGoogleTaskRefreshReader("/private/read", requester);

    assert.deepEqual(await reader.listTasks({ listId: "list/one" }), [
      { id: "open" },
      { id: "gone", deleted: true },
    ]);
    assert.ok(
      requests.every(
        ({ url, method, params }) =>
          method === "GET" &&
          url ===
            "https://tasks.googleapis.com/tasks/v1/lists/list%2Fone/tasks" &&
          params?.showCompleted === true &&
          params?.showDeleted === true &&
          params?.showHidden === true &&
          params?.maxResults === 100,
      ),
    );
  });
});
