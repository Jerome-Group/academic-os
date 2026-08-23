import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  codexSessionArguments,
  MORNING_SESSION_MODEL,
  MORNING_SESSION_REASONING_EFFORT,
  MORNING_SESSION_SANDBOX,
} from "../../src/routine/index.js";

const arguments_ = codexSessionArguments("the morning's prompt");

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

  it("states the sandbox rather than inheriting whatever the machine is set to", () => {
    assert.equal(MORNING_SESSION_SANDBOX, "danger-full-access");
    assert.equal(
      arguments_[arguments_.indexOf("--sandbox") + 1],
      MORNING_SESSION_SANDBOX,
    );
  });

  it("expects a module folder rather than a checkout, and ends on the prompt", () => {
    assert.ok(arguments_.includes("--skip-git-repo-check"));
    assert.equal(arguments_.at(-1), "the morning's prompt");
  });
});
