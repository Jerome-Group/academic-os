#!/usr/bin/env node

import { runAuditCommand } from "./commands/audit-command.js";
import { runCalendarSetupCommand } from "./commands/calendar-setup-command.js";
import { runCalendarRefreshCommand } from "./commands/calendar-refresh-command.js";
import { runCalendarProposeCommand } from "./commands/calendar-propose-command.js";
import { runCalendarPromoteCommand } from "./commands/calendar-promote-command.js";
import { runCurationMigrateCommand } from "./commands/curation-migrate-command.js";
import { writeOperationalError } from "./commands/operational-error-output.js";
import { runPinnedRefreshCommand } from "./commands/pinned-refresh-command.js";
import { runSeedCommand } from "./commands/seed-command.js";
import {
  isTaskOperation,
  runTasksOperateCommand,
} from "./commands/tasks-operate-command.js";
import { runTasksProvisionCommand } from "./commands/tasks-provision-command.js";
import { runTasksRefreshCommand } from "./commands/tasks-refresh-command.js";
import { runTextbooksCatchUpCommand } from "./commands/textbooks-catch-up-command.js";
import { runTextbooksMigrateCommand } from "./commands/textbooks-migrate-command.js";
import { runTextbooksSweepCommand } from "./commands/textbooks-sweep-command.js";
import { runRepairCommand } from "./commands/repair-command.js";
import { runRoutineMorningCommand } from "./commands/routine-morning-command.js";

const arguments_ = process.argv.slice(2);
const json = arguments_.includes("--json");

try {
  if (arguments_[0] === "seed") {
    await runSeedCommand(arguments_, json);
  } else if (arguments_[0] === "repair") {
    await runRepairCommand(arguments_, json);
  } else if (arguments_[0] === "pinned" && arguments_[1] === "refresh") {
    await runPinnedRefreshCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "curation" && arguments_[1] === "migrate") {
    await runCurationMigrateCommand(arguments_.slice(1), json);
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
  } else if (arguments_[0] === "tasks" && isTaskOperation(arguments_[1])) {
    await runTasksOperateCommand(arguments_[1], arguments_.slice(1), json);
  } else if (arguments_[0] === "textbooks" && arguments_[1] === "catch-up") {
    await runTextbooksCatchUpCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "textbooks" && arguments_[1] === "sweep") {
    await runTextbooksSweepCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "textbooks" && arguments_[1] === "migrate") {
    await runTextbooksMigrateCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "routine" && arguments_[1] === "morning") {
    await runRoutineMorningCommand(arguments_.slice(1), json);
  } else {
    await runAuditCommand(arguments_, json);
  }
} catch (error) {
  writeOperationalError(error, json);
}
