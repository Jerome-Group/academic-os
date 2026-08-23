import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  codexSessionArguments,
  MODULE_PASS_SCHEMA,
  MORNING_SESSION_MODEL,
  MORNING_SESSION_REASONING_EFFORT,
  MORNING_SESSION_SANDBOX,
} from "../../src/routine/index.js";

const arguments_ = codexSessionArguments({
  prompt: "the morning's prompt",
  schemaPath: "/state/routine/sessions/2026-08-23/AB1234/result-schema.json",
  resultPath: "/state/routine/sessions/2026-08-23/AB1234/result.json",
});

function flagValue(flag: string): string | undefined {
  return arguments_[arguments_.indexOf(flag) + 1];
}

describe("the Codex invocation a module pass runs under", () => {
  it("runs headless, on the named model at the named effort", () => {
    assert.equal(arguments_[0], "exec");
    assert.equal(MORNING_SESSION_MODEL, "gpt-5.6-luna");
    assert.equal(MORNING_SESSION_REASONING_EFFORT, "max");
    assert.ok(
      arguments_.includes("--model") &&
        arguments_[arguments_.indexOf("--model") + 1] === MORNING_SESSION_MODEL,
    );
    assert.ok(
      arguments_.some(
        (argument) =>
          argument ===
          `model_reasoning_effort="${MORNING_SESSION_REASONING_EFFORT}"`,
      ),
    );
  });

  it("gets the module folder to write in and nothing wider", () => {
    assert.equal(MORNING_SESSION_SANDBOX, "workspace-write");
    assert.equal(flagValue("--sandbox"), MORNING_SESSION_SANDBOX);
  });

  it("has the harness enforce the report's shape and write it down", () => {
    assert.equal(
      flagValue("--output-schema"),
      "/state/routine/sessions/2026-08-23/AB1234/result-schema.json",
    );
    assert.equal(
      flagValue("--output-last-message"),
      "/state/routine/sessions/2026-08-23/AB1234/result.json",
    );
    assert.deepEqual(MODULE_PASS_SCHEMA.required, [
      "curated",
      "rederived",
      "superseded",
      "parked",
      "docWrites",
      "failures",
    ]);
  });

  it("names every property in `required`, which structured-output mode insists on", () => {
    const unsatisfied: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== "object" || node === null) return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object" && typeof schema.properties === "object") {
        const properties = Object.keys(
          schema.properties as Record<string, unknown>,
        );
        const required = Array.isArray(schema.required) ? schema.required : [];
        for (const property of properties) {
          if (!required.includes(property)) {
            unsatisfied.push(`${path}.${property}`);
          }
        }
      }
      for (const [key, value] of Object.entries(schema)) {
        walk(value, `${path}.${key}`);
      }
    };

    walk(JSON.parse(JSON.stringify(MODULE_PASS_SCHEMA)), "schema");

    assert.deepEqual(
      unsatisfied,
      [],
      "an optional field is offered as null and listed in `required`, never omitted",
    );
  });

  it("demands of the harness exactly what the parser demands, so neither can accept what the other refuses", () => {
    const schema = JSON.parse(JSON.stringify(MODULE_PASS_SCHEMA));

    // Structured-output mode requires every property to be listed, so an absent destination is
    // offered as null rather than omitted.
    assert.deepEqual(schema.properties.superseded.items.required, [
      "item",
      "destination",
    ]);
    assert.deepEqual(
      schema.properties.superseded.items.properties.destination.type,
      ["string", "null"],
    );
    assert.deepEqual(schema.properties.curated.items.required, [
      "item",
      "destination",
    ]);
    const nonEmptyFields: Array<[string, string]> = [
      ["curated", "item"],
      ["curated", "destination"],
      ["parked", "evidence"],
      ["docWrites", "summary"],
      ["failures", "message"],
    ];
    for (const [bucket, field] of nonEmptyFields) {
      assert.equal(
        schema.properties[bucket].items.properties[field].minLength,
        1,
        `${bucket}.${field} must refuse the empty string`,
      );
    }
  });

  it("expects a module folder rather than a checkout, and ends on the prompt", () => {
    assert.ok(arguments_.includes("--skip-git-repo-check"));
    assert.equal(arguments_.at(-1), "the morning's prompt");
  });
});
