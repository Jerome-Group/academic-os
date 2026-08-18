import { OperationalError } from "../operational-error.js";
import { liveDoDate, liveDue } from "./do-date.js";
import {
  refreshTaskRegister,
  type TaskRefreshTarget,
} from "./refresh-task-registers.js";
import { taskFailure } from "./task-failure.js";
import type {
  LiveTask,
  LiveTaskFields,
  TaskOperation,
  TaskOperationReport,
  TaskOperationWriter,
  TaskRefreshReader,
  TaskRegister,
  TaskRegisterStore,
} from "./types.js";

// The live list took the push and then read back as something else. It carries the task ID
// because the task exists: reporting this as parked would tell the Owner nothing had moved when
// the change is already on their phone.
class UnverifiedPush extends OperationalError {
  constructor(
    readonly taskId: string,
    message: string,
  ) {
    super("operational-failure", message);
    this.name = "UnverifiedPush";
  }
}

// A verified push, and the register row only a create leaves behind: the task ID Google returned
// and the provenance Google never sees are the two things the pull that follows cannot recover.
interface PushedTask {
  taskId: string;
  createdRegister?: TaskRegister;
}

// The Promotion pattern for tasks: the push reaches the live list first, the live result is read
// back before anything local moves, and the register catches up through the same pull an
// unattended refresh runs — so the register only ever mirrors what Google accepted. A push that
// fails parks the operation: the register keeps no row for work Google never took, and nothing
// queues it for later.
export async function applyTaskOperation(input: {
  target: TaskRefreshTarget;
  operation: TaskOperation;
  writer: TaskOperationWriter;
  reader: TaskRefreshReader;
}): Promise<TaskOperationReport> {
  let pushed: PushedTask;
  try {
    pushed = await pushToLiveList(input.target, input.operation, input.writer);
  } catch (error) {
    if (error instanceof UnverifiedPush) {
      return {
        ...reportHead(input),
        outcome: "unverified",
        taskId: error.taskId,
        register: null,
        failure: { code: error.code, message: error.message },
      };
    }
    return {
      ...reportHead(input),
      outcome: "parked",
      taskId: null,
      register: null,
      failure: taskFailure(error, "The task operation failed unexpectedly."),
    };
  }
  // The live list has changed by here, so nothing below may report the operation as parked.
  if (pushed.createdRegister !== undefined) {
    await input.target.registerStore.write(pushed.createdRegister);
  }
  return {
    ...reportHead(input),
    outcome: "applied",
    taskId: pushed.taskId,
    register: await refreshTaskRegister(input.target, input.reader),
  };
}

async function pushToLiveList(
  target: TaskRefreshTarget,
  operation: TaskOperation,
  writer: TaskOperationWriter,
): Promise<PushedTask> {
  const register = await readRegister(target.registerStore, target.module);
  const listId = register.listId;
  if (operation.name === "create") {
    const fields = { title: operation.title, ...writtenFields(operation) };
    const { id } = await writer.createTask({ listId, task: fields });
    await verifyLiveFields(writer, listId, id, fields);
    return {
      taskId: id,
      createdRegister: registerWithCreatedRow(register, id, operation),
    };
  }
  const taskId = registeredTaskId(register, operation.taskId, target.module);
  if (operation.name === "cancel") {
    await writer.deleteTask({ listId, taskId });
    await verifyLiveCancellation(writer, listId, taskId);
    return { taskId };
  }
  const fields =
    operation.name === "complete"
      ? { status: "completed" as const }
      : writtenFields(operation);
  await writer.patchTask({ listId, taskId, patch: fields });
  await verifyLiveFields(writer, listId, taskId, fields);
  return { taskId };
}

async function readRegister(
  store: TaskRegisterStore,
  module: string,
): Promise<TaskRegister> {
  const register = await store.read();
  if (register === undefined) {
    throw new OperationalError(
      "missing-target",
      `${module} has no Task register; run tasks provision first.`,
    );
  }
  return register;
}

// The register names the module's tasks, so an ID it does not hold is one this session has not
// pulled — pushing to it would be writing blind at a list Google may have moved on from. A row it
// holds as cancelled names a task Google deleted, and a cancelled task is never re-pushed.
function registeredTaskId(
  register: TaskRegister,
  taskId: string,
  module: string,
): string {
  const row = register.tasks.find((entry) => entry.taskId === taskId);
  if (row === undefined) {
    throw new OperationalError(
      "missing-target",
      `The Task register for ${module} has no row for task ${taskId}; run tasks refresh first.`,
    );
  }
  if (row.status === "cancelled") {
    throw new OperationalError(
      "invalid-target",
      `The Task register for ${module} holds task ${taskId} as cancelled; Google no longer has it.`,
    );
  }
  return taskId;
}

function writtenFields(operation: {
  doDate?: string;
  notes?: string;
  title?: string;
}): LiveTaskFields {
  return {
    ...(operation.title === undefined ? {} : { title: operation.title }),
    ...(operation.doDate === undefined
      ? {}
      : { due: liveDue(operation.doDate) }),
    ...(operation.notes === undefined ? {} : { notes: operation.notes }),
  };
}

async function verifyLiveFields(
  writer: TaskOperationWriter,
  listId: string,
  taskId: string,
  fields: LiveTaskFields,
): Promise<void> {
  const live = await writer.readTask({ listId, taskId });
  if (live === undefined || live.deleted === true || !carries(live, fields)) {
    throw new UnverifiedPush(
      taskId,
      `The live task ${taskId} did not read back as the operation asked; run tasks refresh to mirror what Google has.`,
    );
  }
}

async function verifyLiveCancellation(
  writer: TaskOperationWriter,
  listId: string,
  taskId: string,
): Promise<void> {
  const live = await writer.readTask({ listId, taskId });
  if (live !== undefined && live.deleted !== true) {
    throw new UnverifiedPush(
      taskId,
      `The live task ${taskId} is still on the list after its cancel push.`,
    );
  }
}

function carries(live: LiveTask, fields: LiveTaskFields): boolean {
  return (
    (fields.title === undefined || (live.title ?? "") === fields.title) &&
    (fields.notes === undefined || (live.notes ?? "") === fields.notes) &&
    (fields.due === undefined ||
      liveDoDate(live.due) === liveDoDate(fields.due)) &&
    (fields.status === undefined ||
      (live.status ?? "needsAction") === fields.status)
  );
}

function registerWithCreatedRow(
  register: TaskRegister,
  taskId: string,
  operation: TaskOperation & { name: "create" },
): TaskRegister {
  return {
    listId: register.listId,
    tasks: [
      ...register.tasks,
      {
        taskId,
        title: operation.title,
        ...(operation.doDate === undefined ? {} : { doDate: operation.doDate }),
        status: "open",
        ...(operation.notes === undefined ? {} : { notes: operation.notes }),
        ...(operation.provenance === undefined
          ? {}
          : { provenance: operation.provenance }),
      },
    ],
  };
}

function reportHead(input: {
  target: TaskRefreshTarget;
  operation: TaskOperation;
}): Pick<TaskOperationReport, "schemaVersion" | "command" | "module"> {
  return {
    schemaVersion: 1,
    command: `tasks ${input.operation.name}`,
    module: { semester: input.target.semester, module: input.target.module },
  };
}
