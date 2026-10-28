#!/usr/bin/env node

import { runCapabilitiesCommand } from "./capabilities/command.js";
import { runAuditCommand } from "./commands/audit-command.js";
import { runCalendarPromoteCommand } from "./commands/calendar-promote-command.js";
import { runCalendarProposeCommand } from "./commands/calendar-propose-command.js";
import { runCalendarRefreshCommand } from "./commands/calendar-refresh-command.js";
import { runCalendarSetupCommand } from "./commands/calendar-setup-command.js";
import { runCurationMigrateCommand } from "./commands/curation-migrate-command.js";
import { runCurationRederiveCommand } from "./commands/curation-rederive-command.js";
import { runImportsStatusCommand } from "./commands/imports-status-command.js";
import { runImportsPreflightCommand } from "./commands/imports-preflight-command.js";
import { runLearningMaterialsCommand } from "./commands/learning-materials-command.js";
import { runOfferingReadinessCommand } from "./commands/offering-readiness-command.js";
import { writeOperationalError } from "./commands/operational-error-output.js";
import { runPinnedRefreshCommand } from "./commands/pinned-refresh-command.js";
import { runRepairCommand } from "./commands/repair-command.js";
import { runRoutineMorningCommand } from "./commands/routine-morning-command.js";
import { runRoutineRepositoryRepairCommand } from "./commands/routine-repository-repair-command.js";
import { runRoutineRepositoryStatusCommand } from "./commands/routine-repository-status-command.js";
import { runSeedCommand } from "./commands/seed-command.js";
import {
  isTaskOperation,
  runTasksOperateCommand,
} from "./commands/tasks-operate-command.js";
import { runTasksRecordLifecycleCommand } from "./commands/tasks-record-lifecycle-command.js";
import { runTasksApplyPlanCommand } from "./commands/tasks-apply-plan-command.js";
import { runTasksRecoveryCommand } from "./commands/tasks-recovery-command.js";
import { runTasksRestoreCommand } from "./commands/tasks-restore-command.js";
import { runTasksStatusCommand } from "./commands/tasks-status-command.js";
import { runTasksProvisionCommand } from "./commands/tasks-provision-command.js";
import { runTasksRefreshCommand } from "./commands/tasks-refresh-command.js";
import { runTextbooksCatchUpCommand } from "./commands/textbooks-catch-up-command.js";
import { runTextbooksMigrateCommand } from "./commands/textbooks-migrate-command.js";
import { runTextbooksReconcileCommand } from "./commands/textbooks-reconcile-command.js";
import { runTextbooksSweepCommand } from "./commands/textbooks-sweep-command.js";
import { OperationalError } from "./mounted/index.js";

const arguments_ = process.argv.slice(2);
const json = arguments_.includes("--json");

try {
  if (arguments_[0] === "capabilities") {
    await runCapabilitiesCommand(arguments_);
  } else if (
    arguments_.length === 0 ||
    arguments_[0] === "--help" ||
    arguments_[0] === "help"
  ) {
    await runCapabilitiesCommand(["capabilities", "index", "--json"]);
  } else if (arguments_[0] === "seed") {
    await runSeedCommand(arguments_, json);
  } else if (arguments_[0] === "repair") {
    await runRepairCommand(arguments_, json);
  } else if (arguments_[0] === "pinned" && arguments_[1] === "refresh") {
    await runPinnedRefreshCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "curation" && arguments_[1] === "migrate") {
    await runCurationMigrateCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "curation" && arguments_[1] === "rederive") {
    await runCurationRederiveCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "calendar" && arguments_[1] === "setup") {
    await runCalendarSetupCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "calendar" && arguments_[1] === "refresh") {
    await runCalendarRefreshCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "calendar" && arguments_[1] === "propose") {
    await runCalendarProposeCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "calendar" && arguments_[1] === "promote") {
    await runCalendarPromoteCommand(arguments_.slice(1), json);
  } else if (
    arguments_[0] === "tasks" &&
    arguments_[1] === "record-lifecycle"
  ) {
    await runTasksRecordLifecycleCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "tasks" && arguments_[1] === "apply-plan") {
    await runTasksApplyPlanCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "tasks" && arguments_[1] === "recovery") {
    await runTasksRecoveryCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "tasks" && arguments_[1] === "restore") {
    await runTasksRestoreCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "tasks" && arguments_[1] === "status") {
    await runTasksStatusCommand(arguments_.slice(1), json);
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
  } else if (arguments_[0] === "textbooks" && arguments_[1] === "reconcile") {
    await runTextbooksReconcileCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "routine" && arguments_[1] === "morning") {
    await runRoutineMorningCommand(arguments_.slice(1), json);
  } else if (
    arguments_[0] === "routine" &&
    arguments_[1] === "repository-repair"
  ) {
    await runRoutineRepositoryRepairCommand(arguments_.slice(1), json);
  } else if (
    arguments_[0] === "routine" &&
    arguments_[1] === "repository-status"
  ) {
    await runRoutineRepositoryStatusCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "imports" && arguments_[1] === "preflight") {
    await runImportsPreflightCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "imports" && arguments_[1] === "status") {
    await runImportsStatusCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "learning" && arguments_[1] === "materials") {
    await runLearningMaterialsCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "offering" && arguments_[1] === "readiness") {
    await runOfferingReadinessCommand(arguments_.slice(1), json);
  } else if (arguments_[0] === "audit") {
    await runAuditCommand(arguments_, json);
  } else {
    throw new OperationalError(
      "invalid-arguments",
      "Unknown command. Discover actions with academic-os capabilities index --json.",
    );
  }
} catch (error) {
  writeOperationalError(error, json);
}
