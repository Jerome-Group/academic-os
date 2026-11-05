import { planNamingJson } from "../naming/index.js";
import type { OperationTool } from "./types.js";

export function createNamingTools(): OperationTool[] {
  return [
    {
      name: "naming_plan",
      title: "Plan artifact names",
      description:
        "Resolve a complete evidence-bound naming request without reading or writing academic artifacts. Classification, native representations and occupied paths must be accepted metadata. Unresolved results do not authorize a migration.",
      fields: [
        {
          name: "request",
          description:
            "UTF-8 JSON encoded NamingRequest, schema urn:academic-os:naming-request:1; includes versioned policy, module, complete artifacts and occupied paths.",
          required: true,
        },
      ],
      call: async (input) => {
        const report = planNamingJson(
          Buffer.from(input.get("request") ?? "", "utf8"),
        );
        return { report, failed: report.outcome !== "resolved" };
      },
    },
  ];
}
