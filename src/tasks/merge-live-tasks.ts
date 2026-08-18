import type {
  LiveTask,
  TaskRegister,
  TaskRegisterChanges,
  TaskRegisterEntry,
  TaskStatus,
} from "./types.js";

// The live list wins for every task Google knows, so a pull rewrites the mirrored fields of a
// pushed row and leaves provenance — which Google never sees — exactly as the register had it.
// A row Google does not know is either not pushed yet, and survives untouched, or was deleted
// there, and becomes cancelled rather than disappearing.
export function mergeLiveTasks(
  register: TaskRegister,
  liveTasks: LiveTask[],
): { register: TaskRegister; changes: TaskRegisterChanges } {
  const changes: TaskRegisterChanges = { added: 0, updated: 0, cancelled: 0 };
  const liveById = new Map(liveTasks.map((task) => [task.id, task] as const));
  const mirrored = new Set<string>();
  const tasks = register.tasks.map((entry) => {
    const live =
      entry.taskId === undefined ? undefined : liveById.get(entry.taskId);
    if (live === undefined) {
      return entry.taskId === undefined ? entry : cancel(entry, changes);
    }
    mirrored.add(live.id);
    if (live.deleted === true) return cancel(entry, changes);
    const merged = mirrorLiveTask(live, entry.provenance);
    if (isSameEntry(entry, merged)) return entry;
    changes.updated += 1;
    return merged;
  });
  for (const live of liveTasks) {
    if (mirrored.has(live.id) || live.deleted === true) continue;
    tasks.push(mirrorLiveTask(live));
    changes.added += 1;
  }
  return { register: { listId: register.listId, tasks }, changes };
}

function cancel(
  entry: TaskRegisterEntry,
  changes: TaskRegisterChanges,
): TaskRegisterEntry {
  if (entry.status === "cancelled") return entry;
  changes.cancelled += 1;
  return { ...entry, status: "cancelled" };
}

function mirrorLiveTask(
  live: LiveTask,
  provenance?: TaskRegisterEntry["provenance"],
): TaskRegisterEntry {
  const doDate = liveDoDate(live.due);
  return {
    taskId: live.id,
    title: live.title ?? "",
    ...(doDate === undefined ? {} : { doDate }),
    status: liveStatus(live.status),
    ...(live.notes === undefined || live.notes === ""
      ? {}
      : { notes: live.notes }),
    ...(provenance === undefined ? {} : { provenance }),
  };
}

// Google records only the date half of `due` and discards the time, so the register mirrors the
// date it can read back and never a time it cannot.
function liveDoDate(due: string | undefined): string | undefined {
  const date = due?.slice(0, 10);
  return date !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(date)
    ? date
    : undefined;
}

function liveStatus(status: LiveTask["status"]): TaskStatus {
  return status === "completed" ? "completed" : "open";
}

function isSameEntry(
  entry: TaskRegisterEntry,
  merged: TaskRegisterEntry,
): boolean {
  return (
    entry.title === merged.title &&
    entry.doDate === merged.doDate &&
    entry.status === merged.status &&
    entry.notes === merged.notes
  );
}
