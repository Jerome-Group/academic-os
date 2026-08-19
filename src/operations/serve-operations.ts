import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import type { McpDispatcher } from "./dispatch-mcp-message.js";

export const OPERATIONS_ENDPOINT_PATH = "/mcp";

const MAXIMUM_BODY_BYTES = 1_000_000;
const PARSE_ERROR = -32700;

export interface OperationsServerHandle {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

// Streamable HTTP, and only the half this surface needs: one endpoint taking a JSON-RPC request
// and answering it in the response body. Nothing here is authenticated, because the address the
// server is bound to is the authentication — a machine that can open the socket is on the tailnet.
export async function startOperationsServer(input: {
  host: string;
  port: number;
  dispatch: McpDispatcher;
}): Promise<OperationsServerHandle> {
  const server = createServer((request, response) => {
    void handle(request, response, input.dispatch);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : input.port;
  return {
    host: input.host,
    port,
    url: `http://${formatHost(input.host)}:${port}${OPERATIONS_ENDPOINT_PATH}`,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
        server.closeAllConnections();
      }),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  dispatch: McpDispatcher,
): Promise<void> {
  if (readPath(request) !== OPERATIONS_ENDPOINT_PATH) {
    return writeText(response, 404, "Not found.");
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return writeText(response, 405, "This endpoint takes JSON-RPC over POST.");
  }
  // Only a browser sends an Origin, and no browser is a client here: refusing one closes the
  // DNS-rebinding path by which a page the Owner opened could reach a server that trusts its
  // network rather than its callers.
  if (request.headers.origin !== undefined) {
    return writeText(response, 403, "This endpoint takes no browser origin.");
  }
  if (!(request.headers["content-type"] ?? "").includes("application/json")) {
    return writeText(response, 415, "This endpoint takes application/json.");
  }
  let body: string;
  try {
    body = await readBody(request);
  } catch {
    return writeText(response, 413, "The request body is too large.");
  }
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return writeJson(response, 400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: PARSE_ERROR, message: "The request body is not JSON." },
    });
  }
  const answer = await dispatch(message);
  if (answer === undefined) {
    response.writeHead(202).end();
    return;
  }
  writeJson(response, 200, answer);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAXIMUM_BODY_BYTES) throw new Error("Body too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readPath(request: IncomingMessage): string {
  return (request.url ?? "").split("?")[0] ?? "";
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response
    .writeHead(status, { "content-type": "application/json" })
    .end(`${JSON.stringify(body)}\n`);
}

function writeText(
  response: ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, { "content-type": "text/plain" }).end(`${body}\n`);
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}
