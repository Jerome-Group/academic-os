import assert from "node:assert/strict";
import { it } from "node:test";
import { createModuleActivityTools } from "../../src/module-activity/actions.js";
import { createMcpDispatcher } from "../../src/operations/dispatch-mcp-message.js";
import { startOperationsServer } from "../../src/operations/serve-operations.js";

it("preserves generic JSON-RPC numeric spellings and long IDs while bounding activity envelopes before invocation", async () => {
  const server = await startOperationsServer({
    hosts: ["127.0.0.1"],
    port: 0,
    dispatch: createMcpDispatcher({
      tools: [
        ...createModuleActivityTools(),
        {
          name: "legacy",
          title: "Legacy",
          description: "Legacy",
          fields: [],
          async call() {
            return { report: { legacy: true }, failed: false };
          },
        },
      ],
      serverInfo: {
        name: "compatibility",
        title: "Compatibility",
        version: "1",
      },
    }),
  });
  try {
    const url = server.urls[0];
    assert.ok(url);
    for (const id of [
      "1.0",
      "1.5",
      "1e0",
      "-0",
      JSON.stringify("x".repeat(300)),
    ]) {
      const response: Response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"legacy","arguments":{}}}`,
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.ok(!result.error);
      assert.equal(result.result.isError, false);
      assert.deepEqual(JSON.parse(result.result.content[0].text), {
        legacy: true,
      });
    }
    const response: Response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "x".repeat(300),
        method: "tools/call",
        params: { name: "module_activity_prepare", arguments: {} },
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.result.structuredContent.code, "invalid-packet");
    assert.match(
      result.result.structuredContent.evidence.join(" "),
      /Activity MCP ID measured 302 encoded bytes/,
    );
  } finally {
    await server.close();
  }
});
