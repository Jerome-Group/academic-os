#!/usr/bin/env node
import { runHostDeploymentCommand } from "./host-deployment-command.js";

try {
  await runHostDeploymentCommand(process.argv.slice(2));
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ kind: "refused", code: "invalid-controls", evidence: [error instanceof Error ? error.message : "Invalid host deployment invocation."] })}\n`,
  );
  process.exitCode = 2;
}
