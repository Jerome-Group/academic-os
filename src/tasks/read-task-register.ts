import {
  refreshTaskTargetSnapshot,
  type TaskRefreshTarget,
  type TaskRegisterTarget,
} from "./refresh-task-registers.js";
import type {
  TaskRefreshReader,
  TaskRegisterReadReport,
  TaskTargetRegisterReadReport,
} from "./types.js";

// Reading a register means catching it up first: the live list is the authority, so rows read
// without a pull are only as current as the last one. The pull is the same read-only refresh an
// unattended run makes — a list it cannot reach leaves the register untouched and reads stale.
export async function readTaskRegister(input: {
  target: TaskRefreshTarget;
  reader: TaskRefreshReader;
}): Promise<TaskRegisterReadReport> {
  const report = await readTaskTargetRegister({
    target: {
      identity: {
        kind: "module",
        key: `${input.target.semester}/${input.target.module}`,
        title: input.target.module,
      },
      registerStore: input.target.registerStore,
      ...(input.target.receiptStore === undefined
        ? {}
        : { receiptStore: input.target.receiptStore }),
      ...(input.target.configBinding === undefined
        ? {}
        : { configBinding: input.target.configBinding }),
    },
    reader: input.reader,
  });
  const { target: _identity, failure, ...register } = report.register;
  return {
    schemaVersion: 1,
    command: "tasks read-register",
    outcome: report.outcome,
    module: { semester: input.target.semester, module: input.target.module },
    register: {
      semester: input.target.semester,
      module: input.target.module,
      ...register,
      ...(failure === undefined ? {} : { failure }),
    },
    tasks: report.tasks,
  };
}

export async function readTaskTargetRegister(input: {
  target: TaskRegisterTarget;
  reader: TaskRefreshReader;
}): Promise<TaskTargetRegisterReadReport> {
  const { report: register, tasks } = await refreshTaskTargetSnapshot(
    input.target,
    input.reader,
  );
  return {
    schemaVersion: 1,
    command: "tasks read-register",
    outcome: register.freshness === "fresh" ? "read" : "stale",
    target: input.target.identity,
    register,
    tasks,
  };
}
