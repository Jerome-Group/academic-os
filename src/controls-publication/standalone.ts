#!/usr/bin/env node
import { runControlsPublicationCommand } from "./command.js";

try {
  await runControlsPublicationCommand(process.argv.slice(2));
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ kind: "refused", code: "invalid-controls", evidence: [error instanceof Error ? error.message : "Invalid invocation."] })}\n`,
  );
  process.exitCode = 2;
}
