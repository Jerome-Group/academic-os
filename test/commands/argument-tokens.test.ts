import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgumentTokens } from "../../src/commands/argument-tokens.js";

const input = {
  command: "audit",
  valueFlags: ["--config"],
  booleanFlags: ["--json"],
  usage: "Usage: audit --config <path> [--json]",
};

describe("command argument tokens", () => {
  it("rejects a repeated positional command rather than silently consuming it", () => {
    assert.throws(
      () =>
        parseArgumentTokens({
          ...input,
          arguments: ["audit", "--config", "config.json", "audit", "ignored"],
        }),
      /Unexpected argument: audit/u,
    );
  });

  it("accepts supported value and boolean flags", () => {
    const parsed = parseArgumentTokens({
      ...input,
      arguments: ["audit", "--config", "config.json", "--json"],
    });
    assert.deepEqual([...parsed.values], [["--config", "config.json"]]);
    assert.deepEqual([...parsed.flags], ["--json"]);
  });
});
