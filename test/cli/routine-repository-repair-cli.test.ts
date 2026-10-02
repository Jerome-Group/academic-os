import assert from "node:assert/strict";
import { it } from "node:test";
import { runCli } from "../support/run-cli.js";

it("refuses unsupported repository repair requests before configuration or effects", async () => {
  for (const extra of [
    ["--apply"],
    ["--check-only", "--check-only"],
    ["--model", "gpt-6-luna"],
    ["--admin"],
  ]) {
    const result = await runCli(
      "routine",
      "repository-repair",
      "--config",
      "/missing/synthetic-config",
      ...extra,
      "--json",
    );
    assert.equal(result.exitCode, 2, result.stdout);
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
  }
  const result = await runCli("routine", "repository-repair", "--json");
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
});
