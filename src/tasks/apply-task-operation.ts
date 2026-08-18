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
  TaskRefreshReader,
  TaskRegister,
  TaskWriter,
} from "./types.js";

// The Promotion pattern for tasks: the push reaches the live list first, the live result is read
// back before anything local moves, and the register catches up through the same pull an
// unattended refresh runs — so the Owner's phone and the register never disagree about a task
// Google accepted. A push that fails parks the operation: the register keeps no row for work
// Google never took, and nothing queues it for later.
export async function applyTaskOperation(input: {
  target: TaskRefreshTarget;
  operation: TaskOperation;
  writer: TaskWriter;
  reader: TaskRefreshReader;
}): Promise<TaskOperationReport> {
  let taskId: string;
  try {
    taskId = await pushAndVerify(input.target, input.operation, input.writer);
  } catch (error) {
    return {
      ...reportHead(input),
      outcome: "parked",
      taskId: null,
      register: null,
      failure: taskFailure(error, "The task operation failed unexpectedly."),
    };
  }
  return {
    ...reportHead(input),
    outcome: "applied",
    taskId,
    register: await refreshTaskRegister(input.target, input.reader),
  };
}

async function pushAndVerify(
  target: TaskRefreshTarget,
  operation: TaskOperation,
  writer: TaskWriter,
): Promise<string> {
  const register = await target.registerStore.read();
  if (register === undefined) {
    throw new OperationalError(
      "missing-target",
      `${target.module} has no Task register; run tasks provision first.`,
    );
  }
  const listId = register.listId;
  if (operation.name === "create") {
    const fields = { title: operation.title, ...writtenFields(operation) };
    const created = await writer.createTask({ listId, task: fields });
    await verifyLiveFields(writer, listId, created.id, fields);
    // The task ID Google returned is the row's identity from here on, and the provenance Google
    // never sees has no other way in — so the row is written before the refresh mirrors over it.
    await target.registerStore.write(
      registerWithCreatedRow(register, created.id, operation),
    );
    return created.id;
  }

  const taskId = operation.taskId;
  if (!register.tasks.some((entry) => entry.taskId === taskId)) {
    throw new OperationalError(
      "missing-target",
      `The Task register for ${target.module} has no row for task ${taskId}; run tasks refresh first.`,
    );
  }
  if (operation.name === "cancel") {
    await writer.deleteTask({ listId, taskId });
    await verifyLiveCancellation(writer, listId, taskId);
    return taskId;
  }
  const fields =
    operation.name === "complete"
      ? { status: "completed" as const }
      : writtenFields(operation);
  await writer.patchTask({ listId, taskId, patch: fields });
  await verifyLiveFields(writer, listId, taskId, fields);
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
  writer: TaskWriter,
  listId: string,
  taskId: string,
  fields: LiveTaskFields,
): Promise<void> {
  const live = await writer.readTask({ listId, taskId });
  if (live === undefined || live.deleted === true || !carries(live, fields)) {
    throw new OperationalError(
      "operational-failure",
      `The live task ${taskId} did not read back as the operation asked; the next pull mirrors what Google has.`,
    );
  }
}

async function verifyLiveCancellation(
  writer: TaskWriter,
  listId: string,
  taskId: string,
): Promise<void> {
  const live = await writer.readTask({ listId, taskId });
  if (live !== undefined && live.deleted !== true) {
    throw new OperationalError(
      "operational-failure",
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
