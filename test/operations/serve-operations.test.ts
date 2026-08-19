import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  createMcpDispatcher,
  OPERATIONS_ENDPOINT_PATH,
  startOperationsServer,
  type OperationsServerHandle,
  type OperationTool,
} from "../../src/operations/index.js";

const tool: OperationTool = {
  name: "echo",
  title: "Echo",
  description: "Return what it was given.",
  fields: [{ name: "said", description: "What to say back.", required: true }],
  call: async (values) => ({
    report: { said: values.get("said") },
    failed: false,
  }),
};

let server: OperationsServerHandle;
let url: string;
let origin: string;

before(async () => {
  server = await startOperationsServer({
    // The mini binds its tailnet addresses; a test binds loopback in both families, which is the
    // same address-by-address rule on a machine with no tailnet.
    hosts: ["127.0.0.1", "::1"],
    port: 0,
    dispatch: createMcpDispatcher({
      tools: [tool],
      serverInfo: {
        name: "academic-os",
        title: "Operations",
        version: "1.0.0",
      },
    }),
  });
  url = server.urls[0] ?? "";
  origin = url.slice(0, url.lastIndexOf(OPERATIONS_ENDPOINT_PATH));
});

after(async () => {
  await server.close();
});

async function post(
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18" },
});

describe("the Operations server over HTTP", () => {
  it("serves the endpoint on every address it was bound to", async () => {
    assert.equal(server.urls.length, 2);
    assert.match(server.urls[0] ?? "", /^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);
    assert.match(server.urls[1] ?? "", /^http:\/\/\[::1\]:\d+\/mcp$/u);

    const second = await fetch(server.urls[1] ?? "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initialize,
    });

    assert.equal(second.status, 200);
  });

  it("answers a JSON-RPC request in the response body", async () => {
    const response = await post(initialize);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.serverInfo.name, "academic-os");
  });

  it("requires no credential and consults none that is offered", async () => {
    const bare = await post(initialize);
    const bearing = await post(initialize, {
      authorization: "Bearer not-a-real-token",
    });

    assert.equal(bare.status, 200);
    assert.equal(bearing.status, 200);
    assert.deepEqual(await bearing.json(), await bare.json());
  });

  it("calls a tool", async () => {
    const response = await post(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { said: "hello" } },
      }),
    );

    const body = await response.json();
    assert.equal(body.result.isError, false);
    assert.deepEqual(JSON.parse(body.result.content[0].text), {
      said: "hello",
    });
  });

  it("answers a notification with no body at all", async () => {
    const response = await post(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );

    assert.equal(response.status, 202);
    assert.equal(await response.text(), "");
  });

  it("refuses a browser origin", async () => {
    const response = await post(initialize, {
      origin: "https://example.invalid",
    });

    assert.equal(response.status, 403);
  });

  it("refuses a body that is not JSON, and one that is not JSON-typed", async () => {
    const unparseable = await post("not json");
    const untyped = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: initialize,
    });

    assert.equal(unparseable.status, 400);
    assert.equal((await unparseable.json()).error.code, -32700);
    assert.equal(untyped.status, 415);
  });

  it("refuses another method and another path", async () => {
    const listening = await fetch(url);
    const elsewhere = await fetch(`${origin}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initialize,
    });

    assert.equal(listening.status, 405);
    assert.equal(listening.headers.get("allow"), "POST");
    assert.equal(elsewhere.status, 404);
  });
});
