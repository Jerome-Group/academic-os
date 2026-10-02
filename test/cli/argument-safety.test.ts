import assert from "node:assert/strict";
import { it } from "node:test";

import { runCli } from "../support/run-cli.js";

it("refuses duplicate target, configuration and apply flags before loading or writing", async () => {
  const cases = [
    ["audit", "--config", "missing.json", "--config", "other.json"],
    [
      "audit",
      "--config",
      "missing.json",
      "--module",
      "MH2100",
      "--module",
      "MH2500",
    ],
    ["seed", "--config", "missing.json", "--apply", "--apply"],
    ["tasks", "refresh", "--config", "missing.json", "--json"],
  ];
  for (const arguments_ of cases) {
    const result = await runCli(...arguments_, "--json");
    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.error.code, "invalid-arguments");
    assert.match(report.error.message, /Duplicate argument:/u);
  }
});

it("calendar promotion requires one config and rejects unknown arguments before provider access", async () => {
  const cases = [
    ["calendar", "promote", "proposal-id"],
    ["calendar", "promote", "proposal-id", "--config", "--unexpected"],
    [
      "calendar",
      "promote",
      "proposal-id",
      "--config",
      "missing.json",
      "--unexpected",
    ],
    [
      "calendar",
      "promote",
      "proposal-id",
      "--config",
      "missing.json",
      "--config",
      "other.json",
    ],
    [
      "calendar",
      "promote",
      "proposal-id",
      "--config",
      "missing.json",
      "another-proposal",
    ],
  ];
  for (const arguments_ of cases) {
    const result = await runCli(...arguments_, "--json");
    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
  }
});
