#!/usr/bin/env node

import { runAuditCommand } from "./commands/audit-command.js";
import { writeOperationalError } from "./commands/operational-error-output.js";
import { runSeedCommand } from "./commands/seed-command.js";

const arguments_ = process.argv.slice(2);
const json = arguments_.includes("--json");

try {
  if (arguments_[0] === "seed") {
    await runSeedCommand(arguments_, json);
  } else {
    await runAuditCommand(arguments_, json);
  }
} catch (error) {
  writeOperationalError(error, json);
}
