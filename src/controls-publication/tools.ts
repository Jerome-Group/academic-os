import type { SchemaOperationTool } from "../operations/types.js";
import { createPublicationService } from "./index.js";
import type { RuntimeContext } from "./owner.js";
import {
  validateCreateInput,
  validateInspectInput,
  validatePublishInput,
  wireSchema,
} from "./schema.js";

export function createPublicationTools(
  context: RuntimeContext = { exclusionPaths: [] },
): SchemaOperationTool[] {
  const service = createPublicationService(context);
  return [
    {
      kind: "schema",
      name: "controls_create_generated_candidate",
      title: "Create generated Module candidate",
      description:
        "Create a private host-owned Module candidate from exact identity bytes. No existing target admission.",
      inputSchema: wireSchema("CreateWireInput"),
      async call(input) {
        if (!validateCreateInput(input)) return invalid();
        const report = await service.create({
          requestId: input.requestId,
          identityBytes: Buffer.from(input.identityBytesBase64, "base64"),
        });
        return { report, failed: report.kind !== "created" };
      },
    },
    {
      kind: "schema",
      name: "controls_publish_generation",
      title: "Publish complete generated Module controls",
      description:
        "Publish an exact complete bundle to a generated candidate with an absent or digest expectation. Other workflows remain unavailable.",
      inputSchema: wireSchema("PublishWireInput"),
      async call(input) {
        if (!validatePublishInput(input)) return invalid();
        const report = await service.publish({
          candidateId: input.candidateId,
          requestId: input.requestId,
          expectedHead: input.expectedHead,
          bundleBytes: Buffer.from(input.inputBytesBase64, "base64"),
        });
        return { report, failed: report.kind !== "published" };
      },
    },
    {
      kind: "schema",
      name: "controls_inspect_candidate",
      title: "Inspect generated Module controls",
      description:
        "Read current or pinned complete controls under an existing gate. Does not initialize or settle publisher data.",
      inputSchema: wireSchema("InspectWireInput"),
      async call(input) {
        if (!validateInspectInput(input)) return invalid();
        const report = await service.inspect(input);
        return {
          report,
          failed: report.kind !== "empty" && report.kind !== "inspected",
        };
      },
    },
  ];
}

function invalid() {
  return {
    report: {
      kind: "refused",
      code: "invalid-controls",
      evidence: ["Input does not match the strict publication action schema."],
    },
    failed: true,
  };
}
