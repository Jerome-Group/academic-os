import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { pathToFileURL } from "node:url";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { Ajv } from "ajv";
import { publicationInputBase64 } from "../../src/controls-publication/schema.js";
import { canonicalBase64 } from "../../src/controls-publication/codec.js";
import {
  validateCreateInput,
  validateInspectInput,
  validatePublishInput,
} from "../../src/controls-publication/schema.js";

it("lists only reachable input schemas and preserves strict server validation", async (context) => {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "publication-schema-"),
  );
  const script = `import { createMcpDispatcher } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "dist/src/operations/dispatch-mcp-message.js")).href)};
import { createPublicationTools } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "dist/src/controls-publication/tools.js")).href)};
const dispatch=createMcpDispatcher({tools:createPublicationTools(),serverInfo:{name:"schema-fixture",title:"Schema fixture",version:"1"}});
process.stdout.write(JSON.stringify(await dispatch({jsonrpc:"2.0",id:1,method:"tools/list"})));
`;
  const processResult = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 10_000 },
  );
  await writeFile(join(root, "transport.json"), processResult.stdout);
  await writeFile(
    join(root, "process.json"),
    JSON.stringify(
      {
        executable: process.execPath,
        script,
        pid: processResult.pid,
        status: processResult.status,
        signal: processResult.signal,
        stderr: processResult.stderr,
      },
      null,
      2,
    ),
  );
  assert.equal(processResult.status, 0, processResult.stderr);
  const response: unknown = JSON.parse(processResult.stdout);
  assert.ok(
    typeof response === "object" && response !== null && "result" in response,
  );
  const listed = ListToolsResultSchema.parse(response.result);
  const ajv = new Ajv({ strict: true, allErrors: true });
  ajv.addFormat("publication-base64", canonicalBase64);
  ajv.addFormat("publication-input-base64", publicationInputBase64);
  const publish = {
    candidateId: "candidate-a",
    requestId: "publish-a",
    expectedHead: { kind: "absent" },
    inputBytesBase64: "e30=",
  };
  const cases = [
    {
      tool: "controls_create_generated_candidate",
      server: validateCreateInput,
      definitions: [],
      inputs: [
        { requestId: "create-a", identityBytesBase64: "e30=" },
        { requestId: "", identityBytesBase64: "e30=" },
        { requestId: "create-a", identityBytesBase64: "e30" },
        {
          requestId: "create-a",
          identityBytesBase64: "e30=",
          root: "/foreign",
        },
        { requestId: "create-a" },
        null,
      ],
    },
    {
      tool: "controls_publish_generation",
      server: validatePublishInput,
      definitions: ["ExpectedHead"],
      inputs: [
        publish,
        {
          ...publish,
          expectedHead: { kind: "digest", headByteSha256: "a".repeat(64) },
        },
        { ...publish, expectedHead: { kind: "digest" } },
        {
          ...publish,
          expectedHead: { kind: "absent", headByteSha256: "a".repeat(64) },
        },
        { ...publish, expectedHead: { kind: "selected" } },
        { ...publish, inputBytesBase64: "%%%" },
        { ...publish, inputBytesBase64: "e30=", receipt: {} },
        [],
      ],
    },
    {
      tool: "controls_inspect_candidate",
      server: validateInspectInput,
      definitions: [],
      inputs: [
        { candidateId: "candidate-a", selection: { kind: "current" } },
        {
          candidateId: "candidate-a",
          selection: { kind: "pinned", generationId: "generation-a" },
        },
        { candidateId: "candidate-a", selection: { kind: "pinned" } },
        {
          candidateId: "candidate-a",
          selection: { kind: "current", generationId: "generation-a" },
        },
        { candidateId: "candidate-a", selection: { kind: "unknown" } },
        {
          candidateId: "candidate-a",
          selection: { kind: "current" },
          root: "/foreign",
        },
        false,
      ],
    },
  ];
  for (const entry of cases) {
    const tool = listed.tools.find((tool) => tool.name === entry.tool);
    assert.ok(tool);
    const definitions = tool.inputSchema.definitions;
    assert.deepEqual(
      typeof definitions === "object" && definitions !== null
        ? Object.keys(definitions)
        : [],
      entry.definitions,
    );
    const validate = ajv.compile(tool.inputSchema);
    for (const input of entry.inputs)
      assert.equal(
        validate(input),
        entry.server(input),
        `${entry.tool} ${JSON.stringify(input)}`,
      );
  }
  context.diagnostic(`Retained publication schema transport ${root}`);
});
