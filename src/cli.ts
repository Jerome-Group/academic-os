#!/usr/bin/env node

import { runAuditCommand } from "./commands/audit-command.js";
import { runCalendarSetupCommand } from "./commands/calendar-setup-command.js";
import { runCalendarRefreshCommand } from "./commands/calendar-refresh-command.js";
import { runCalendarProposeCommand } from "./commands/calendar-propose-command.js";
import { runCalendarPromoteCommand } from "./commands/calendar-promote-command.js";
import { writeOperationalError } from "./commands/operational-error-output.js";
import { runSeedCommand } from "./commands/seed-command.js";
import { runTasksProvisionCommand } from "./commands/tasks-provision-command.js";
import { runTasksRefreshCommand } from "./commands/tasks-refresh-command.js";
import { runTextbooksCatchUpCommand } from "./commands/textbooks-catch-up-command.js";
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
  } else if (arguments_[0] === "calendar" && arguments_[1] === "propose") {
    await runCalendarProposeCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "calendar" && arguments_[1] === "promote") {
    await runCalendarPromoteCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "tasks" && arguments_[1] === "provision") {
    await runTasksProvisionCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "tasks" && arguments_[1] === "refresh") {
    await runTasksRefreshCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "textbooks" && arguments_[1] === "catch-up") {
    await runTextbooksCatchUpCommand(arguments_.slice(1), json);
  } else {
    await runAuditCommand(arguments_, json);
  }
} catch (error) {
  writeOperationalError(error, json);
}
