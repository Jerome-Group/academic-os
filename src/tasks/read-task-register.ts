import {
  refreshTaskRegister,
  type TaskRefreshTarget,
} from "./refresh-task-registers.js";
import type {
  TaskRefreshReader,
  TaskRegisterEntry,
  TaskRegisterReadReport,
  TaskRegisterStore,
} from "./types.js";

// Reading a register means catching it up first: the live list is the authority, so rows read
// without a pull are only as current as the last one. The pull is the same read-only refresh an
// unattended run makes — a list it cannot reach leaves the register untouched and reads stale.
export async function readTaskRegister(input: {
  target: TaskRefreshTarget;
  reader: TaskRefreshReader;
}): Promise<TaskRegisterReadReport> {
  const register = await refreshTaskRegister(input.target, input.reader);
  return {
    schemaVersion: 1,
    command: "tasks read-register",
    outcome: register.freshness === "fresh" ? "read" : "stale",
    module: { semester: input.target.semester, module: input.target.module },
    register,
    tasks: await readRows(input.target.registerStore),
  };
}

// A register the pull could not read is already reported stale with the reason it failed, so the
// rows come back empty rather than as a second copy of the same failure.
async function readRows(
  store: TaskRegisterStore,
): Promise<TaskRegisterEntry[]> {
  try {
    return (await store.read())?.tasks ?? [];
  } catch {
    return [];
  }
}
