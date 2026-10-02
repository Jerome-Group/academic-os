import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  createMcpDispatcher,
  OPERATIONS_ENDPOINT_PATH,
  type OperationsServerHandle,
  type OperationTool,
  startOperationsServer,
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

const unixFixture =
  process.env.ACADEMIC_OS_REPOSITORY_FIXTURE_TRANSPORT === "unix";
const originalCwd = process.cwd();
let fixtureRoot: string | undefined;
let server: OperationsServerHandle | undefined;
const sockets = new Map<string, string>();
async function fixtureListen(server: Server, host: string): Promise<number> {
  const socket = host.includes(":") ? "ipv6.sock" : "ipv4.sock";
  sockets.set(host, socket);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return 0;
}
async function http(url: string, options: RequestInit = {}): Promise<Response> {
  if (!unixFixture) return await fetch(url, options);
  const target = new URL(url);
  const host = target.hostname.replace(/^\[|\]$/gu, "");
  return await new Promise((resolve, reject) => {
    const call = request(
      {
        socketPath: sockets.get(host),
        path: target.pathname,
        method: options.method ?? "GET",
        headers: options.headers as Record<string, string>,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              headers: response.headers as Record<string, string>,
            }),
          ),
        );
        response.on("error", reject);
      },
    );
    call.on("error", reject);
    call.end(options.body);
  });
}
let url: string;
let origin: string;

before(async () => {
  if (unixFixture) {
    fixtureRoot = await mkdtemp(join(tmpdir(), "academic-os-operations-http-"));
    process.chdir(fixtureRoot);
  }
  server = await startOperationsServer({
    // The mini binds its tailnet addresses; a test binds loopback in both families, which is the
    // same address-by-address rule on a machine with no tailnet.
    hosts: ["127.0.0.1", "::1"],
    port: 0,
    ...(unixFixture ? { listen: fixtureListen } : {}),
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
  await server?.close();
  if (fixtureRoot) {
    process.chdir(originalCwd);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function post(
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await http(url, {
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
    assert.ok(server);
    assert.equal(server.urls.length, 2);
    assert.match(server.urls[0] ?? "", /^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);
    assert.match(server.urls[1] ?? "", /^http:\/\/\[::1\]:\d+\/mcp$/u);

    const second = await http(server.urls[1] ?? "", {
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
    const untyped = await http(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: initialize,
    });

    assert.equal(unparseable.status, 400);
    assert.equal((await unparseable.json()).error.code, -32700);
    assert.equal(untyped.status, 415);
  });

  it("refuses another method and another path", async () => {
    const listening = await http(url);
    const elsewhere = await http(`${origin}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initialize,
    });

    assert.equal(listening.status, 405);
    assert.equal(listening.headers.get("allow"), "POST");
    assert.equal(elsewhere.status, 404);
  });
});

it("preserves original listen failure while cleaning partially started servers", async () => {
  const failure = Object.assign(new Error("Synthetic bind refusal"), {
    code: "EPERM",
  });
  const started: Server[] = [];
  let cleanupAttempted = false;
  await assert.rejects(
    startOperationsServer({
      hosts: ["one", "two"],
      port: 0,
      dispatch: async () => undefined,
      listen: async (server) => {
        started.push(server);
        if (started.length === 2) throw failure;
        Object.defineProperty(server, "listening", { get: () => true });
        server.close = () => {
          cleanupAttempted = true;
          throw new Error("Synthetic cleanup failure");
        };
        return 0;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(started.length, 2);
  assert.equal(cleanupAttempted, true);
});
it("controller fixture sandbox refuses the default TCP listener; ordinary CI exercises TCP success", async () => {
  if (unixFixture)
    await assert.rejects(
      startOperationsServer({
        hosts: ["127.0.0.1"],
        port: 0,
        dispatch: async () => undefined,
      }),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "EPERM",
    );
  else {
    assert.ok(server);
    assert.equal(server.urls.length, 2);
  }
});
