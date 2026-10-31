import type { TaskRecoveryStore } from "./task-recovery-types.js";
import { isDeepStrictEqual } from "node:util";

import { OperationalError } from "../operational-error.js";
import { mergeLiveTasks } from "./merge-live-tasks.js";
import { provisionedList } from "./provisioned-list.js";
import { taskExecutionSnapshot } from "./task-execution-plan.js";
import { taskFailure } from "./task-failure.js";
import { taskRegisterGeneration } from "./task-refresh-receipt.js";
import type {
  ConfiguredModuleIdentity,
  LiveTask,
  TaskRefreshModuleReport,
  TaskRefreshReader,
  TaskRefreshReceiptStore,
  TaskRefreshReport,
  TaskRegister,
  TaskRegisterCounts,
  TaskRegisterEntry,
  TaskRegisterStore,
  TaskTargetIdentity,
  TaskTargetRefreshReport,
} from "./types.js";

export interface TaskRefreshTarget extends ConfiguredModuleIdentity {
  registerStore: TaskRegisterStore;
  receiptStore?: TaskRefreshReceiptStore;
  recoveryStore?: TaskRecoveryStore;
  configBinding?: string;
}

export interface TaskRegisterTarget {
  identity: TaskTargetIdentity;
  registerStore: TaskRegisterStore;
  receiptStore?: TaskRefreshReceiptStore;
  recoveryStore?: TaskRecoveryStore;
  configBinding?: string;
}

export interface TaskRefreshSnapshot {
  report: TaskTargetRefreshReport;
  tasks: TaskRegisterEntry[];
}

// Pull-only: a refresh reads the live list and rewrites the register, and has no authority to
// write to Google at all. A failed target reports stale beside the other active targets,
// so one unreachable list never stops the rest of the active set catching up.
export async function refreshTaskRegisters(input: {
  targets: TaskRefreshTarget[];
  reader: TaskRefreshReader;
}): Promise<TaskRefreshReport> {
  const modules: TaskRefreshModuleReport[] = [];
  for (const target of input.targets) {
    modules.push(await refreshTaskRegister(target, input.reader));
  }
  const staleCount = modules.filter(
    ({ freshness }) => freshness === "stale",
  ).length;
  return {
    schemaVersion: 1,
    command: "tasks refresh",
    outcome:
      staleCount === 0
        ? "refreshed"
        : staleCount === modules.length
          ? "stale"
          : "partially-refreshed",
    modules,
  };
}

export async function refreshTaskTargets(input: {
  targets: TaskRegisterTarget[];
  reader: TaskRefreshReader;
}): Promise<TaskTargetRefreshReport[]> {
  const reports: TaskTargetRefreshReport[] = [];
  for (const target of input.targets) {
    reports.push(await refreshTaskTarget(target, input.reader));
  }
  return reports;
}

// One target's pull, and the whole of what a task operation refreshes with once its push is
// verified: the same merge, the same conflict rules, the same stale report when the list is
// unreachable.
export async function refreshTaskRegister(
  target: TaskRefreshTarget,
  reader: TaskRefreshReader,
): Promise<TaskRefreshModuleReport> {
  const refreshed = await refreshTaskTarget(
    {
      identity: {
        kind: "module",
        key: `${target.semester}/${target.module}`,
        title: target.module,
      },
      registerStore: target.registerStore,
      ...(target.recoveryStore === undefined
        ? {}
        : { recoveryStore: target.recoveryStore }),
      ...(target.receiptStore === undefined
        ? {}
        : { receiptStore: target.receiptStore }),
      ...(target.configBinding === undefined
        ? {}
        : { configBinding: target.configBinding }),
    },
    reader,
  );
  const { target: _identity, failure, ...result } = refreshed;
  return {
    semester: target.semester,
    module: target.module,
    ...result,
    ...(failure === undefined ? {} : { failure }),
  };
}

export async function refreshTaskTarget(
  target: TaskRegisterTarget,
  reader: TaskRefreshReader,
): Promise<TaskTargetRefreshReport> {
  return (await refreshTaskTargetSnapshot(target, reader)).report;
}

export async function refreshTaskTargetSnapshot(
  target: TaskRegisterTarget,
  reader: TaskRefreshReader,
): Promise<TaskRefreshSnapshot> {
  let register: TaskRegister | undefined;
  let observedAt = new Date().toISOString();
  try {
    register = structuredClone(await target.registerStore.read());
    const bound = provisionedList(register, target.identity.title);
    const live = validateLiveTasks(
      await reader.listTasks({ listId: bound.listId }),
    );
    observedAt = new Date().toISOString();
    const providerSnapshot = taskExecutionSnapshot(live);
    await target.recoveryStore?.capture({
      target: target.identity,
      listId: bound.listId,
      register: bound.register,
      live,
      reason: "refresh",
    });
    const merged = mergeLiveTasks(bound.register, live);
    await target.registerStore.write(merged.register);
    const readback = structuredClone(await target.registerStore.read());
    if (readback !== undefined) register = readback;
    if (readback === undefined || !isDeepStrictEqual(readback, merged.register))
      throw new OperationalError(
        "operational-failure",
        "The Task register changed or disappeared during refresh readback; refresh again.",
      );
    const generation = taskRegisterGeneration(readback);
    const report: TaskTargetRefreshReport = {
      target: target.identity,
      freshness: "fresh",
      listId: bound.listId,
      counts: countRegister(readback),
      changes: merged.changes,
      generation,
      providerSnapshot,
      observedAt,
    };
    if (target.receiptStore !== undefined) {
      report.receipt = await target.receiptStore.record({
        schemaVersion: 1,
        target: target.identity,
        listId: bound.listId,
        observedAt,
        freshness: "fresh",
        generation,
        providerSnapshot,
        ...(target.configBinding === undefined
          ? {}
          : { configBinding: target.configBinding }),
      });
    }
    return { report, tasks: readback.tasks };
  } catch (error) {
    const report: TaskTargetRefreshReport = {
      target: target.identity,
      freshness: "stale",
      listId: register?.listId ?? null,
      counts: countRegister(register),
      changes: { added: 0, updated: 0, cancelled: 0 },
      failure: taskFailure(
        error,
        "The Tasks pull or its verified receipt failed.",
      ),
    };
    if (target.receiptStore !== undefined) {
      try {
        report.receipt = await target.receiptStore.record({
          schemaVersion: 1,
          target: target.identity,
          listId: report.listId,
          observedAt,
          freshness: "stale",
          failure: report.failure as { code: string; message: string },
          ...(target.configBinding === undefined
            ? {}
            : { configBinding: target.configBinding }),
        });
      } catch {
        report.failure = {
          code: "operational-failure",
          message:
            (report.failure?.message ?? "Task refresh failed.") +
            " The private Task-refresh failure receipt could not be persisted.",
        };
      }
    }
    return { report, tasks: register?.tasks ?? [] };
  }
}

function validateLiveTasks(tasks: LiveTask[]): LiveTask[] {
  if (
    !Array.isArray(tasks) ||
    tasks.some(
      (task) =>
        typeof task !== "object" ||
        task === null ||
        typeof task.id !== "string" ||
        task.id === "",
    )
  ) {
    throw new OperationalError(
      "operational-failure",
      "The Tasks pull received an invalid provider response.",
    );
  }
  return tasks;
}

function countRegister(register: TaskRegister | undefined): TaskRegisterCounts {
  const tasks = register?.tasks ?? [];
  return {
    tasks: tasks.length,
    open: tasks.filter(({ status }) => status === "open").length,
    completed: tasks.filter(({ status }) => status === "completed").length,
    cancelled: tasks.filter(({ status }) => status === "cancelled").length,
    unpushed: tasks.filter(({ taskId }) => taskId === undefined).length,
  };
}
