import { OperationalError } from "../operational-error.js";
import { liveDoDate, liveDue } from "./do-date.js";
import { provisionedList } from "./provisioned-list.js";
import {
  refreshTaskTarget,
  type TaskRegisterTarget,
  type TaskRefreshTarget,
} from "./refresh-task-registers.js";
import { taskFailure } from "./task-failure.js";
import type {
  LiveTask,
  LiveTaskFields,
  TaskOperation,
  TaskOperationReport,
  TaskTargetOperationReport,
  TaskOperationWriter,
  TaskRefreshReader,
  TaskRegister,
} from "./types.js";

// A lost write response cannot prove rejection. Keep known IDs so refresh can reconcile the
// live list, and leave a create's ID unknown when Google did not return it.
class UnverifiedPush extends OperationalError {
  constructor(
    readonly taskId: string | null,
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

const researchOnlyProvenanceKeys = ["claim", "meeting", "deliverable"] as const;

// The Promotion pattern for tasks: the push reaches the live list first, the live result is read
// back before anything local moves, and the register catches up through the same pull an
// unattended refresh runs — so the register only ever mirrors what Google accepted. A push that
// is rejected parks the operation; a lost response needs refresh before another push.
export async function applyTaskOperation(input: {
  target: TaskRefreshTarget;
  operation: TaskOperation;
  writer: TaskOperationWriter;
  reader: TaskRefreshReader;
}): Promise<TaskOperationReport> {
  const report = await applyTaskTargetOperation({
    target: {
      identity: {
        kind: "module",
        key: `${input.target.semester}/${input.target.module}`,
        title: input.target.module,
      },
      registerStore: input.target.registerStore,
    },
    operation: input.operation,
    writer: input.writer,
    reader: input.reader,
  });
  return moduleOperationReport(report, input.target);
}

export async function applyTaskTargetOperation(input: {
  target: TaskRegisterTarget;
  operation: TaskOperation;
  writer: TaskOperationWriter;
  reader: TaskRefreshReader;
}): Promise<TaskTargetOperationReport> {
  assertSupportedTargetProvenance(input.target, input.operation);
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
    try {
      await input.target.registerStore.write(pushed.createdRegister);
    } catch (error) {
      return {
        ...reportHead(input),
        outcome: "applied",
        taskId: pushed.taskId,
        register: null,
        failure: taskFailure(
          error,
          "The verified task could not be recorded locally; refresh before further operations.",
        ),
      };
    }
  }
  return {
    ...reportHead(input),
    outcome: "applied",
    taskId: pushed.taskId,
    register: await refreshTaskTarget(input.target, input.reader),
  };
}

function assertSupportedTargetProvenance(
  target: TaskRegisterTarget,
  operation: TaskOperation,
): void {
  if (
    target.identity.kind === "research-project" ||
    operation.name !== "create" ||
    operation.provenance === undefined
  ) {
    return;
  }
  const unsupported = researchOnlyProvenanceKeys.filter(
    (key) => operation.provenance?.[key] !== undefined,
  );
  if (unsupported.length > 0) {
    throw new OperationalError(
      "invalid-arguments",
      `${unsupported.join(", ")} provenance is available only for research-project targets.`,
    );
  }
}

async function pushToLiveList(
  target: TaskRegisterTarget,
  operation: TaskOperation,
  writer: TaskOperationWriter,
): Promise<PushedTask> {
  const { register, listId } = provisionedList(
    await target.registerStore.read(),
    target.identity.title,
  );
  if (operation.name === "create") {
    const fields = { title: operation.title, ...writtenFields(operation) };
    const { id } = await sendMutation(null, async () => {
      const result = await writer.createTask({ listId, task: fields });
      if (typeof result.id !== "string" || result.id === "")
        throw new Error("Task creation returned no ID.");
      return result;
    });
    await verifyLiveFields(writer, listId, id, fields);
    return {
      taskId: id,
      createdRegister: registerWithCreatedRow(register, id, operation),
    };
  }
  const taskId = registeredTaskId(
    register,
    operation.taskId,
    target.identity.title,
  );
  if (operation.name === "cancel") {
    await sendMutation(taskId, () => writer.deleteTask({ listId, taskId }));
    await verifyLiveCancellation(writer, listId, taskId);
    return { taskId };
  }
  const fields =
    operation.name === "complete"
      ? { status: "completed" as const }
      : writtenFields(operation);
  await sendMutation(taskId, () =>
    writer.patchTask({ listId, taskId, patch: fields }),
  );
  await verifyLiveFields(writer, listId, taskId, fields);
  return { taskId };
}

async function sendMutation<T>(
  taskId: string | null,
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    const providerError = error as {
      code?: unknown;
      response?: { status?: unknown };
    } | null;
    const status = providerError?.response?.status ?? providerError?.code;
    if (
      typeof status === "number" &&
      status >= 400 &&
      status < 500 &&
      status !== 408 &&
      status !== 429
    )
      throw error;
    throw new UnverifiedPush(
      taskId,
      "The task write response could not confirm whether Google accepted it; run tasks refresh and inspect the live list before retrying.",
    );
  }
}

// The register names the target's tasks, so an ID it does not hold is one this session has not
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
  let live: LiveTask | undefined;
  try {
    live = await writer.readTask({ listId, taskId });
  } catch {
    throw new UnverifiedPush(
      taskId,
      `The live task ${taskId} could not be read after its push; run tasks refresh before retrying.`,
    );
  }
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
  let live: LiveTask | undefined;
  try {
    live = await writer.readTask({ listId, taskId });
  } catch {
    throw new UnverifiedPush(
      taskId,
      `The live task ${taskId} could not be read after its cancel push; run tasks refresh before retrying.`,
    );
  }
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
    ...register,
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
  target: TaskRegisterTarget;
  operation: TaskOperation;
}): Pick<TaskTargetOperationReport, "schemaVersion" | "command" | "target"> {
  return {
    schemaVersion: 1,
    command: `tasks ${input.operation.name}`,
    target: input.target.identity,
  };
}

function moduleOperationReport(
  report: TaskTargetOperationReport,
  target: TaskRefreshTarget,
): TaskOperationReport {
  const register =
    report.register === null
      ? null
      : moduleRefreshReport(report.register, target);
  return {
    schemaVersion: report.schemaVersion,
    command: report.command,
    outcome: report.outcome,
    module: { semester: target.semester, module: target.module },
    taskId: report.taskId,
    register,
    ...(report.failure === undefined ? {} : { failure: report.failure }),
  };
}

function moduleRefreshReport(
  report: NonNullable<TaskTargetOperationReport["register"]>,
  target: TaskRefreshTarget,
): NonNullable<TaskOperationReport["register"]> {
  const { target: _identity, failure, ...result } = report;
  return {
    semester: target.semester,
    module: target.module,
    ...result,
    ...(failure === undefined ? {} : { failure }),
  };
}
