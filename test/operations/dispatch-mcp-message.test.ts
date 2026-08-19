import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMcpDispatcher,
  type JsonRpcResponse,
  type OperationTool,
} from "../../src/operations/index.js";

const serverInfo = {
  name: "academic-os",
  title: "academic-os Operations server",
  version: "1.0.0",
};

const echo: OperationTool = {
  name: "echo",
  title: "Echo",
  description: "Return what it was given.",
  fields: [
    { name: "said", description: "What to say back.", required: true },
    { name: "twice", description: "Say it again." },
  ],
  call: async (values) => ({
    report: { said: values.get("said"), twice: values.get("twice") ?? null },
    failed: values.get("said") === "park",
  }),
};

const refuses: OperationTool = {
  name: "refuses",
  title: "Refuses",
  description: "Throw.",
  fields: [],
  call: async () => {
    throw new Error("The live list is unreachable.");
  },
};

const dispatch = createMcpDispatcher({
  tools: [echo, refuses],
  serverInfo,
});

async function request(
  method: string,
  params?: unknown,
): Promise<JsonRpcResponse> {
  const answer = await dispatch({ jsonrpc: "2.0", id: 7, method, params });
  assert.ok(answer !== undefined, `${method} answered nothing`);
  return answer;
}

function reportOf(result: unknown): unknown {
  const content = (result as { content: Array<{ text: string }> }).content;
  assert.equal(content.length, 1);
  return JSON.parse(content[0]?.text ?? "");
}

describe("the Operations server's MCP surface", () => {
  it("answers initialize in the version the client asked for", async () => {
    const answer = await request("initialize", {
      protocolVersion: "2025-03-26",
    });

    assert.deepEqual(answer.result, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo,
    });
  });

  it("answers initialize in its own latest version when the client's is unknown", async () => {
    const answer = await request("initialize", {
      protocolVersion: "1999-01-01",
    });

    assert.equal(
      (answer.result as { protocolVersion: string }).protocolVersion,
      "2025-06-18",
    );
  });

  it("lists each tool with the schema its declared fields make", async () => {
    const answer = await request("tools/list");

    assert.deepEqual((answer.result as { tools: unknown[] }).tools[0], {
      name: "echo",
      title: "Echo",
      description: "Return what it was given.",
      inputSchema: {
        type: "object",
        properties: {
          said: { type: "string", description: "What to say back." },
          twice: { type: "string", description: "Say it again." },
        },
        required: ["said"],
        additionalProperties: false,
      },
    });
  });

  it("returns a tool's report as text content", async () => {
    const answer = await request("tools/call", {
      name: "echo",
      arguments: { said: "hello" },
    });

    assert.equal((answer.result as { isError: boolean }).isError, false);
    assert.deepEqual(reportOf(answer.result), { said: "hello", twice: null });
  });

  it("marks an operation that did not apply as an error result", async () => {
    const answer = await request("tools/call", {
      name: "echo",
      arguments: { said: "park" },
    });

    assert.equal((answer.result as { isError: boolean }).isError, true);
    assert.deepEqual(reportOf(answer.result), { said: "park", twice: null });
    assert.equal(answer.error, undefined);
  });

  it("reports a thrown operation as an error result rather than a protocol failure", async () => {
    const answer = await request("tools/call", { name: "refuses" });

    assert.equal(answer.error, undefined);
    assert.equal((answer.result as { isError: boolean }).isError, true);
    assert.deepEqual(reportOf(answer.result), {
      command: "refuses",
      outcome: "failed",
      failure: {
        code: "operational-failure",
        message: "The live list is unreachable.",
      },
    });
  });

  it("refuses an unknown tool, a missing argument and an undeclared one", async () => {
    const unknownTool = await request("tools/call", { name: "nothing" });
    const missing = await request("tools/call", {
      name: "echo",
      arguments: {},
    });
    const undeclared = await request("tools/call", {
      name: "echo",
      arguments: { said: "hello", shouted: "hello" },
    });

    assert.equal(unknownTool.error?.code, -32602);
    assert.match(unknownTool.error?.message ?? "", /Unknown tool: nothing/u);
    assert.equal(missing.error?.code, -32602);
    assert.match(missing.error?.message ?? "", /requires said/u);
    assert.equal(undeclared.error?.code, -32602);
    assert.match(undeclared.error?.message ?? "", /does not take shouted/u);
  });

  it("refuses an argument that is not a string", async () => {
    const answer = await request("tools/call", {
      name: "echo",
      arguments: { said: 3 },
    });

    assert.equal(answer.error?.code, -32602);
    assert.match(answer.error?.message ?? "", /non-empty string/u);
  });

  it("refuses an unknown method and a message that is not a request", async () => {
    const unknownMethod = await request("tools/nothing");
    const notARequest = await dispatch("tools/list");

    assert.equal(unknownMethod.error?.code, -32601);
    assert.equal(notARequest?.error?.code, -32600);
  });

  it("answers a notification with nothing at all", async () => {
    assert.equal(
      await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" }),
      undefined,
    );
  });

  it("answers ping so a client can prove the mini is reachable", async () => {
    assert.deepEqual((await request("ping")).result, {});
  });
});
