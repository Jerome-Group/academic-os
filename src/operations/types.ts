// One named string argument a tool takes. The table of them is the whole of what a tool declares
// about its input, so the schema clients read and the parse the tool runs can never disagree.
export interface OperationToolField {
  name: string;
  description: string;
  required?: true;
}

// What a tool did, in the shape its report already takes, plus the one thing the protocol needs
// to know about it: an operation that did not do what was asked reaches the calling agent as an
// error result, so a parked push is visible without the agent having to read the report for it.
export interface OperationToolResult {
  report: unknown;
  failed: boolean;
}

// A served operation: what it is called, what it takes, and what running it does. Nothing here
// names tasks — the server carries whatever tools it is given, so a later surface joins it by
// adding to that list rather than by reopening the server.
export interface OperationTool {
  name: string;
  title: string;
  description: string;
  fields: readonly OperationToolField[];
  call(input: ReadonlyMap<string, string>): Promise<OperationToolResult>;
}

export interface McpServerInfo {
  name: string;
  title: string;
  version: string;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}
