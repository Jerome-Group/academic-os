// The shape a pass's final message must take, handed to the Codex CLI as a JSON Schema so the
// harness enforces it rather than the model remembering it. One source of truth: the prompt shows
// this shape, the CLI validates the final message against it, and `readModulePassOutcome` checks it
// again on the way in — a wrapper that believes an unattended agent checks what it was handed.
const items = (properties: Record<string, unknown>) => ({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  },
});

const text = { type: "string" };

export const MODULE_PASS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "curated",
    "rederived",
    "superseded",
    "parked",
    "docWrites",
    "failures",
  ],
  properties: {
    curated: items({ item: text, destination: text }),
    rederived: items({ item: text, derived: { type: "array", items: text } }),
    superseded: items({ item: text, destination: text }),
    parked: items({ item: text, reason: text, evidence: text }),
    docWrites: items({ file: text, summary: text }),
    failures: items({ code: text, message: text }),
  },
} as const;
