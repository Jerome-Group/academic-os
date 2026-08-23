// The shape a pass's final message must take, handed to the Codex CLI as a JSON Schema so the
// harness enforces it rather than the model remembering it. It states exactly what
// `readModulePassOutcome` demands — `minLength` included — because a schema looser than the parser
// is a morning the CLI accepts and the wrapper then throws away whole.
const text = { type: "string", minLength: 1 } as const;

// Structured-output mode requires `required` to name every property, so a field a pass may have no
// value for cannot be left out — it is offered as null and the parser reads null as absent.
const optionalText = { type: ["string", "null"], minLength: 1 } as const;

const entries = (
  properties: Record<string, unknown>,
  required: readonly string[],
) => ({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  },
});

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
    curated: entries({ item: text, destination: text }, [
      "item",
      "destination",
    ]),
    rederived: entries(
      { item: text, derived: { type: "array", items: text, minItems: 1 } },
      ["item", "derived"],
    ),
    // A supersession replaces a decision, and only a `curated` one named a destination: the line
    // superseding a `source-only` decision has no path to give, and demanding one gets a sentence
    // written where a path goes.
    superseded: entries({ item: text, destination: optionalText }, [
      "item",
      "destination",
    ]),
    parked: entries({ item: text, reason: text, evidence: text }, [
      "item",
      "reason",
      "evidence",
    ]),
    docWrites: entries({ file: text, summary: text }, ["file", "summary"]),
    failures: entries({ code: text, message: text }, ["code", "message"]),
  },
} as const;
