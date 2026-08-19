import { OperationalError } from "../operational-error.js";
import { mergeLiveTasks } from "./merge-live-tasks.js";
import { provisionedList } from "./provisioned-list.js";
import { taskFailure } from "./task-failure.js";
import type {
  ConfiguredModuleIdentity,
  LiveTask,
  TaskRefreshModuleReport,
  TaskRefreshReader,
  TaskRefreshReport,
  TaskRegister,
  TaskRegisterCounts,
  TaskRegisterStore,
} from "./types.js";

export interface TaskRefreshTarget extends ConfiguredModuleIdentity {
  registerStore: TaskRegisterStore;
}

// Pull-only: a refresh reads the live list and rewrites the register, and has no authority to
// write to Google at all. A module whose pull fails keeps its register untouched and reports
// stale, so one unreachable list never stops the rest of the cohort catching up.
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

// One module's pull, and the whole of what a task operation refreshes with once its push is
// verified: the same merge, the same conflict rules, the same stale report when the list is
// unreachable.
export async function refreshTaskRegister(
  target: TaskRefreshTarget,
  reader: TaskRefreshReader,
): Promise<TaskRefreshModuleReport> {
  let register: TaskRegister | undefined;
  try {
    register = await target.registerStore.read();
    const bound = provisionedList(register, target.module);
    const live = validateLiveTasks(
      await reader.listTasks({ listId: bound.listId }),
    );
    const merged = mergeLiveTasks(bound.register, live);
    await target.registerStore.write(merged.register);
    return {
      semester: target.semester,
      module: target.module,
      freshness: "fresh",
      listId: bound.listId,
      counts: countRegister(merged.register),
      changes: merged.changes,
    };
  } catch (error) {
    return {
      semester: target.semester,
      module: target.module,
      freshness: "stale",
      listId: register?.listId ?? null,
      counts: countRegister(register),
      changes: { added: 0, updated: 0, cancelled: 0 },
      failure: taskFailure(error, "The Tasks pull failed unexpectedly."),
    };
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
