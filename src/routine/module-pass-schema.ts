// The shape a pass's final message must take, handed to the Codex CLI as a JSON Schema so the
// harness enforces it rather than the model remembering it. What structured-output's strict mode
// actually guarantees is the object's shape: the declared properties, their types, and that
// `required` names every one. It does not read `minLength` — a pass returned a `""` note under this
// schema on 2026-08-25 — so the parser is the only thing enforcing non-emptiness, and it drops the
// entry it cannot read rather than the pass around it. The bound is kept here because it tells a
// model what is wanted, not because anything checks it.
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
    "withdrawn",
    "parked",
    "docWrites",
    "failures",
    "noted",
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
    // A withdrawal names no destination: it closes the source and settles nothing about the copy,
    // which stays where the decision that placed it put it.
    withdrawn: entries({ item: text, evidence: text }, ["item", "evidence"]),
    parked: entries({ item: text, reason: text, evidence: text }, [
      "item",
      "reason",
      "evidence",
    ]),
    docWrites: entries({ file: text, summary: text }, ["file", "summary"]),
    failures: entries({ code: text, message: text }, ["code", "message"]),
    // A note is read and never actioned, so it names no evidence: the `note` is the whole of what
    // the Owner is told, and a field for settling it would be a field nothing ever settles.
    noted: entries({ item: text, note: text }, ["item", "note"]),
  },
} as const;
