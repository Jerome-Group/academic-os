import { OperationalError } from "../operational-error.js";
import { isJsonObject } from "./json-object.js";
import { readToolArguments, toolInputSchema } from "./tool-arguments.js";
import type { JsonRpcResponse, McpServerInfo, OperationTool } from "./types.js";

// The versions this surface speaks. Tool listing and tool calling are identical across all three,
// so an older client is answered in its own version rather than turned away.
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// The one failure the protocol answers with `method not found`; every other refusal this surface
// makes is about a request's parameters.
class UnknownMethod extends Error {}

export type McpDispatcher = (
  message: unknown,
) => Promise<JsonRpcResponse | undefined>;

// The whole protocol surface: a JSON-RPC message in, the response to write back out, or nothing
// when the message was a notification. Transport is somebody else's problem, so the same
// dispatcher answers an in-process test and an HTTP request identically.
export function createMcpDispatcher(input: {
  tools: readonly OperationTool[];
  serverInfo: McpServerInfo;
}): McpDispatcher {
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
  return async (message) => {
    if (!isJsonObject(message) || typeof message.method !== "string") {
      return failure(null, INVALID_REQUEST, "Expected a JSON-RPC 2.0 request.");
    }
    const id = readId(message.id);
    if (id === undefined) {
      return undefined;
    }
    try {
      return success(id, await route(message.method, message.params));
    } catch (error) {
      if (error instanceof UnknownMethod) {
        return failure(id, METHOD_NOT_FOUND, error.message);
      }
      return error instanceof OperationalError
        ? failure(id, INVALID_PARAMS, error.message)
        : failure(id, INTERNAL_ERROR, "The Operations server failed.");
    }
  };

  async function route(method: string, params: unknown): Promise<unknown> {
    if (method === "initialize") return initialize(params);
    if (method === "ping") return {};
    if (method === "tools/list") {
      return {
        tools: input.tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: toolInputSchema(tool.fields),
        })),
      };
    }
    if (method === "tools/call") return await callTool(params);
    throw new UnknownMethod(`Unknown method: ${method}.`);
  }

  function initialize(params: unknown): unknown {
    const requested = isJsonObject(params) ? params.protocolVersion : undefined;
    return {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.some(
        (version) => version === requested,
      )
        ? requested
        : LATEST_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: input.serverInfo,
    };
  }

  async function callTool(params: unknown): Promise<unknown> {
    const name = isJsonObject(params) ? params.name : undefined;
    const tool = typeof name === "string" ? tools.get(name) : undefined;
    if (tool === undefined) {
      throw new OperationalError(
        "invalid-arguments",
        `Unknown tool: ${String(name)}.`,
      );
    }
    const values = readToolArguments(
      tool,
      isJsonObject(params) ? params.arguments : undefined,
    );
    // Everything past the parse is the operation itself, and an operation that fails is a result
    // the calling agent reads rather than a protocol error: the report says what the live list
    // and the register now hold, which is the only thing that tells it what to do next.
    try {
      const { report, failed } = await tool.call(values);
      return { content: [text(report)], isError: failed };
    } catch (error) {
      return {
        content: [
          text({
            command: tool.name,
            outcome: "failed",
            failure: {
              code:
                error instanceof OperationalError
                  ? error.code
                  : "operational-failure",
              message:
                error instanceof Error
                  ? error.message
                  : "The operation failed unexpectedly.",
            },
          }),
        ],
        isError: true,
      };
    }
  }
}

function text(value: unknown): { type: "text"; text: string } {
  return { type: "text", text: JSON.stringify(value, null, 2) };
}

// A JSON-RPC notification carries no id and is answered with nothing at all; anything else is a
// request whose id comes back on the response.
function readId(id: unknown): string | number | null | undefined {
  if (id === undefined || id === null) return undefined;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function success(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function failure(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
