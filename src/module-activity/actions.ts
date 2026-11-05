import {
  activityProblem,
  activityWireSchema,
  maximumActivityBytes,
  measureActivityWire,
  parseActivity,
} from "../controls/index.js";
import type { SchemaOperationTool } from "../operations/types.js";
import type * as Wire from "./generated/workflow.js";
import { createModuleActivityService } from "./index.js";
import { fromActivityWire, toActivityWire } from "./schema.js";

export const moduleActivityActions = [
  {
    id: "module.activity.prepare",
    cli: ["module", "activity", "prepare"],
    mcp: "module_activity_prepare",
    input: "PrepareInput",
    output: "PrepareResult",
    prerequisites: [
      "host-owned-generated-candidate",
      "selected-complete-generation",
      "recognized-full-procedure-binding",
      "bound-preferences",
      "resolvable-exact-target",
    ],
    effects: ["read-selected-and-retained-control-evidence"],
    invoke: "prepareActivity",
  },
  {
    id: "module.activity.submit",
    cli: ["module", "activity", "submit"],
    mcp: "module_activity_submit",
    input: "SubmitInput",
    output: "SubmitResult",
    prerequisites: [
      "hash-valid-preparation-closure",
      "source-and-judgment-bindings",
      "legal-append-and-supersession",
      "supported-control-only-write-set",
    ],
    effects: ["return-frozen-closeout-plan"],
    invoke: "submitActivityEvidence",
  },
  {
    id: "module.activity.close",
    cli: ["module", "activity", "close"],
    mcp: "module_activity_close",
    input: "CloseInput",
    output: "CloseResult",
    prerequisites: [
      "exact-frozen-plan",
      "expected-head-or-identical-retry",
      "publisher-physical-admission",
    ],
    effects: ["publish-generated-control-and-retained-evidence-generation"],
    invoke: "closeActivity",
  },
] as const;

export function createModuleActivityTools(
  context: Parameters<typeof createModuleActivityService>[0] = {
    exclusionPaths: [],
  },
): SchemaOperationTool[] {
  const service = createModuleActivityService(context);
  const handlers = {
    prepareActivity: (input: unknown) =>
      service.prepare(
        fromActivityWire(
          parseActivity<Wire.PrepareInput>(input, "PrepareInput"),
        ),
      ),
    submitActivityEvidence: (input: unknown) =>
      service.submit(
        fromActivityWire(parseActivity<Wire.SubmitInput>(input, "SubmitInput")),
      ),
    closeActivity: (input: unknown) =>
      service.close(
        fromActivityWire(parseActivity<Wire.CloseInput>(input, "CloseInput")),
      ),
  };
  return moduleActivityActions.map((action) => ({
    kind: "schema",
    name: action.mcp,
    title: action.cli.join(" "),
    description: `${action.effects.join(". ")}. Requires ${action.prerequisites.join(", ")}. Generated control evidence only.`,
    inputSchema: activityWireSchema(action.input),
    outputSchema: activityWireSchema(action.output),
    maximumResponseBytes: maximumActivityBytes - 1,
    async call(input, envelope) {
      let report: unknown;
      try {
        const jsonRpcId = envelope?.jsonRpcId ?? null;
        const idBytes = Buffer.byteLength(JSON.stringify(jsonRpcId));
        if (idBytes > 258)
          throw new Error(
            `Activity MCP ID measured ${idBytes} encoded bytes; limit 258.`,
          );
        if (action.id === "module.activity.close") {
          const close = parseActivity<Wire.CloseInput>(input, "CloseInput");
          const logicalResult = close.plan.logicalResult;
          const prospective = {
            kind: "published",
            logicalResult,
            publication: {
              requestId: close.plan.requestId,
              receiptId: `receipt-${"0".repeat(64)}`,
              planDigest: "0".repeat(64),
              selectedGenerationId: `generation-${"0".repeat(64)}`,
              selectedHeadByteSha256: "0".repeat(64),
            },
            replayed: false,
            currentHead: {
              generationId: `generation-${"0".repeat(64)}`,
              headByteSha256: "0".repeat(64),
            },
          };
          requireActivityTransport(prospective, jsonRpcId);
        }
        report = toActivityWire(await handlers[action.invoke](input));
        parseActivity(report, action.output);
        requireActivityTransport(report, jsonRpcId);
      } catch (error) {
        report = activityProblem(error);
        parseActivity(report, action.output);
      }
      const successful =
        typeof report === "object" &&
        report !== null &&
        "kind" in report &&
        ["prepared", "planned", "published"].includes(String(report.kind));
      return { report, failed: !successful };
    },
  }));
}

function requireActivityTransport(
  report: unknown,
  id: string | number | null,
): void {
  measureActivityWire(
    {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(report) }],
        structuredContent: report,
        isError: false,
      },
    },
    maximumActivityBytes - 1,
  );
}
