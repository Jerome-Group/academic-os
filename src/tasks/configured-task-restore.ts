import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { loadCohortTasksConfig } from "../commands/load-cohort-tasks-config.js";
import { resolveStateRoot } from "../config/index.js";
import {
  configuredResearchProjectTaskTarget,
  configuredTaskTarget,
} from "./configured-task-targets.js";
import { configuredTaskRecoveryStore } from "./configured-task-recovery.js";
import { createFileTaskLifecycleStore } from "./file-task-lifecycle-store.js";
import { createFileTaskRestoreJournal } from "./file-task-restore-journal.js";
import {
  createGoogleTaskOperationWriter,
  createGoogleTaskRefreshReader,
} from "./google-tasks-client.js";
import { readTaskCreationHistory } from "./task-operation-journal-file.js";
import { executeTaskRestore } from "./task-restore.js";
import type { TaskRestoreResult } from "./task-restore-types.js";
import { parseTaskRestorePlan } from "./task-restore-plan.js";

export async function restoreConfiguredTask(input: {
  configPath: string;
  plan: unknown;
  apply?: boolean;
}) {
  const plan = parseTaskRestorePlan(input.plan);
  const { config, tasks } = await loadCohortTasksConfig(input.configPath);
  const stateRoot = await resolveStateRoot(config);
  const excludedRoots = [
    config.driveMount,
    fileURLToPath(new URL("../../../", import.meta.url)),
  ];
  const target =
    plan.target.kind === "research-project"
      ? configuredResearchProjectTaskTarget(config, plan.target.key, {
          requireActive: true,
        })
      : moduleTarget();
  if (!isDeepStrictEqual(plan.target, target.identity))
    throw new Error(
      "Restore target identity differs from current configuration.",
    );
  let executed: TaskRestoreResult | undefined;
  try {
    return await createFileTaskLifecycleStore({
      stateRoot,
      excludedRoots,
    }).withMutation(async (lifecycle) => {
      const history = await readTaskCreationHistory(stateRoot, {
        target: plan.target,
        listId: plan.listId,
      });
      if (
        history.some(
          (record) =>
            record.plan.sourceOccurrenceId === plan.sourceOccurrenceId &&
            record.taskId === null &&
            record.phase === "uncertain",
        )
      )
        return {
          schemaVersion: 1,
          operationId: plan.operationId,
          outcome: "conflict",
          taskId: null,
          originalTaskId: plan.originalTaskId,
          newTaskId: null,
          snapshotId: plan.snapshotId,
          registerFresh: false,
          nativeTimingRestored: false,
          identityHistoryRestored: false,
          code: "source-outcome-unresolved",
        };
      executed = await executeTaskRestore({
        plan,
        apply: input.apply === true,
        target,
        lifecycle,
        recovery: configuredTaskRecoveryStore(config),
        journal: createFileTaskRestoreJournal({ stateRoot, excludedRoots }),
        reader: createGoogleTaskRefreshReader(tasks.credentials.scheduledRead),
        writer: createGoogleTaskOperationWriter(
          tasks.credentials.interactiveWrite,
        ),
      });
      return executed;
    });
  } catch {
    return {
      schemaVersion: 1 as const,
      operationId: plan.operationId,
      originalTaskId: plan.originalTaskId,
      snapshotId: plan.snapshotId,
      taskId: null,
      newTaskId: null,
      nativeTimingRestored: false as const,
      identityHistoryRestored: false as const,
      ...executed,
      outcome:
        executed === undefined ? ("failed" as const) : ("uncertain" as const),
      registerFresh: false,
      code:
        executed === undefined
          ? "lifecycle-unavailable"
          : "lifecycle-owner-failed",
    };
  }
  function moduleTarget() {
    const parts = plan.target.key.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1])
      throw new Error("Restore requires one configured Module.");
    return {
      ...configuredTaskTarget(config, { semester: parts[0], module: parts[1] }),
      identity: {
        kind: "module" as const,
        key: plan.target.key,
        title: parts[1],
      },
    };
  }
}
