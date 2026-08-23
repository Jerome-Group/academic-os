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

  it("demands of the harness exactly what the parser demands, so neither can accept what the other refuses", () => {
    const schema = JSON.parse(JSON.stringify(MODULE_PASS_SCHEMA));

    assert.deepEqual(schema.properties.superseded.items.required, ["item"]);
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
