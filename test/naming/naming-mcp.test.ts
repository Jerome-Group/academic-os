import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveArtifactNames } from "../../src/naming/index.js";
import { createMcpDispatcher } from "../../src/operations/dispatch-mcp-message.js";
import {
  createConfiguredOperationsTools,
  OPERATIONS_SERVER_INFO,
} from "../../src/operations/run-operations-server.js";
import { startOperationsServer } from "../../src/operations/serve-operations.js";
import { artifact, request } from "./fixtures.js";

it("plans through actual configured Operations HTTP and official MCP SDK without live providers", async () => {
  const root = await mkdtemp(join(tmpdir(), "aos-naming-mcp-"));
  const configPath = join(root, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      driveMount: join(root, "synthetic-mount"),
      stateRoot: join(root, "state"),
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Semester", status: "active", modules: ["MH2100"] },
      },
      tasks: {
        credentials: {
          scheduledRead: join(root, "absent-read.json"),
          interactiveWrite: join(root, "absent-write.json"),
        },
      },
    }),
  );
  const before = await readFile(configPath);
  const server = await startOperationsServer({
    hosts: ["127.0.0.1"],
    port: 0,
    dispatch: createMcpDispatcher({
      tools: await createConfiguredOperationsTools(configPath),
      serverInfo: OPERATIONS_SERVER_INFO,
    }),
  });
  const client = new Client({
    name: "synthetic-naming-proof",
    version: "1.0.0",
  });
  try {
    const endpoint = server.urls[0];
    assert.ok(endpoint);
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
    const list = await client.listTools();
    const tool = list.tools.find(({ name }) => name === "naming_plan");
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ["request"]);
    const input = request();
    const reply = await client.callTool({
      name: "naming_plan",
      arguments: { request: JSON.stringify(input) },
    });
    assert.equal(reply.isError, false);
    const content = reply.content;
    assert.ok(Array.isArray(content));
    const first: unknown = content[0];
    assert.ok(
      typeof first === "object" &&
        first !== null &&
        "type" in first &&
        first.type === "text" &&
        "text" in first &&
        typeof first.text === "string",
    );
    assert.deepEqual(JSON.parse(first.text), resolveArtifactNames(input));
    const ambiguous = await client.callTool({
      name: "naming_plan",
      arguments: {
        request: JSON.stringify(
          request([artifact(), artifact({ id: "artifact:second" })]),
        ),
      },
    });
    assert.equal(ambiguous.isError, true);
    const lexical = await client.callTool({
      name: "naming_plan",
      arguments: { request: '{"schemaVersion":1,"schemaVersion":2}' },
    });
    assert.equal(lexical.isError, true);
    assert.deepEqual(await readFile(configPath), before);
    assert.deepEqual(await readdir(root), ["config.json"]);
  } finally {
    await client.close();
    await server.close();
  }
});
