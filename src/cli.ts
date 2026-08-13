#!/usr/bin/env node

import { runAuditCommand } from "./commands/audit-command.js";
import { runCalendarSetupCommand } from "./commands/calendar-setup-command.js";
import { runCalendarRefreshCommand } from "./commands/calendar-refresh-command.js";
import { writeOperationalError } from "./commands/operational-error-output.js";
import { runSeedCommand } from "./commands/seed-command.js";
import { runRepairCommand } from "./commands/repair-command.js";

const arguments_ = process.argv.slice(2);
const json = arguments_.includes("--json");

try {
  if (arguments_[0] === "seed") {
    await runSeedCommand(arguments_, json);
  } else if (arguments_[0] === "repair") {
    await runRepairCommand(arguments_, json);
  } else if (arguments_[0] === "calendar" && arguments_[1] === "setup") {
    await runCalendarSetupCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "calendar" && arguments_[1] === "refresh") {
    await runCalendarRefreshCommand(arguments_.slice(1), json);
  } else {
    await runAuditCommand(arguments_, json);
  }
} catch (error) {
  writeOperationalError(error, json);
}
