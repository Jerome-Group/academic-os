import assert from "node:assert/strict";
import { test } from "node:test";
import { runCliWithEnvironment } from "../support/run-cli.js";

for (const operation of ["create", "change", "complete", "cancel"]) {
  test(
    "legacy CLI " +
      operation +
      " refuses without reading credentials or reaching a provider",
    async () => {
      const result = await runCliWithEnvironment(
        {},
        "tasks",
        operation,
        "--config",
        "/nonexistent-fixture-config",
        "--json",
      );
      assert.equal(result.exitCode, 2);
      const report = JSON.parse(result.stdout);
      assert.equal(report.outcome, "conflict");
      assert.equal(report.code, "exact-plan-required");
    },
  );
}
