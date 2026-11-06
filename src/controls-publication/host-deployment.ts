#!/usr/bin/env node
import type { HostFailure } from "./generated/native-source-contract-1.js";
import { runHostDeploymentCommand } from "./host-deployment-command.js";
import { validateHostFailure } from "./schema.js";

try {
  await runHostDeploymentCommand(process.argv.slice(2));
} catch (error) {
  const result: HostFailure = {
    kind: "refused",
    code: "invalid-controls",
    evidence: [
      error instanceof Error && error.message.length
        ? error.message
        : "Invalid host deployment invocation.",
    ],
  };
  if (!validateHostFailure(result))
    throw new Error("Unsupported host deployment failure.");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 2;
}
