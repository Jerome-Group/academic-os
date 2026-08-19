import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { McpDispatcher } from "./dispatch-mcp-message.js";

export const OPERATIONS_ENDPOINT_PATH = "/mcp";
export const OPERATIONS_PORT = 8765;

const MAXIMUM_BODY_BYTES = 1_000_000;
const PARSE_ERROR = -32700;

export interface OperationsServerHandle {
  urls: string[];
  close(): Promise<void>;
}

// Streamable HTTP, and only the half this surface needs: one endpoint taking a JSON-RPC request
// and answering it in the response body. Nothing here is authenticated, because the addresses the
// server is bound to are the authentication — a machine that can open the socket is on the
// Tailnet. A MagicDNS name resolves to every tailnet address a machine has, so every one of them
// is served rather than leaving a client to fall back from the address it tried first.
export async function startOperationsServer(input: {
  hosts: string[];
  port: number;
  dispatch: McpDispatcher;
}): Promise<OperationsServerHandle> {
  const servers: Server[] = [];
  const urls: string[] = [];
  try {
    for (const host of input.hosts) {
      const server = createServer((request, response) => {
        void handle(request, response, input.dispatch);
      });
      servers.push(server);
      urls.push(
        `http://${formatHost(host)}:${await listen(server, host, input.port)}${OPERATIONS_ENDPOINT_PATH}`,
      );
    }
  } catch (error) {
    await Promise.all(servers.map(close));
    throw error;
  }
  return {
    urls,
    close: async () => {
      await Promise.all(servers.map(close));
    },
  };
}

async function listen(
  server: Server,
  host: string,
  port: number,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
    server.closeAllConnections();
  });
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
  // DNS-rebinding path by which a page the Owner opened could reach a server that trusts the
  // network its callers arrive on.
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
