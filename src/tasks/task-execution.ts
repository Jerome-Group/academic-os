import { isDeepStrictEqual } from "node:util";
import { liveDoDate, liveDue } from "./do-date.js";
import { refreshTaskTargetSnapshot } from "./refresh-task-registers.js";
import { mergeLiveTasks } from "./merge-live-tasks.js";
import {
  parseTaskExecutionPlan,
  taskExecutionPlanDigest,
  taskExecutionSnapshot,
} from "./task-execution-plan.js";
import {
  TaskOperationOwnershipError,
  TaskOperationOccurrenceError,
} from "./task-operation-journal-file.js";
import type {
  TaskExecutionInput,
  TaskExecutionPlan,
  TaskExecutionResult,
  TaskOperationJournalRecord,
  TaskOperationJournalSession,
} from "./task-execution-types.js";
import type { LiveTask, LiveTaskFields, TaskRegister } from "./types.js";

export async function executeTaskPlan(
  input: TaskExecutionInput,
): Promise<TaskExecutionResult> {
  let plan: TaskExecutionPlan;
  try {
    plan = parseTaskExecutionPlan(input.plan);
  } catch {
    return {
      schemaVersion: 1,
      operationId: "invalid",
      outcome: "conflict",
      taskId: null,
      registerFresh: false,
      code: "invalid-plan",
    };
  }
  if (!isDeepStrictEqual(plan.target, input.target.identity))
    return result(plan, "conflict", null, "target-mismatch");
  let completed: TaskExecutionResult | undefined;
  try {
    return await input.journal.withOwner(
      {
        operationId: plan.operationId,
        listId: plan.listId,
        ...(plan.operation.name !== "create" ||
        plan.sourceOccurrenceId === undefined
          ? {}
          : {
              sourceOccurrence: {
                target: { kind: plan.target.kind, key: plan.target.key },
                id: plan.sourceOccurrenceId,
              },
            }),
      },
      async (session) => {
        completed = await executeOwned({ ...input, plan }, session);
        return completed;
      },
    );
  } catch (error) {
    if (completed !== undefined)
      return {
        ...completed,
        outcome: "uncertain",
        registerFresh: false,
        code: "owner-release-failed",
      };
    return result(
      plan,
      error instanceof TaskOperationOwnershipError ||
        error instanceof TaskOperationOccurrenceError
        ? "conflict"
        : "failed",
      null,
      error instanceof TaskOperationOwnershipError
        ? "owner-busy"
        : error instanceof TaskOperationOccurrenceError
          ? "source-occurrence-reserved"
          : "journal-unavailable",
    );
  }
}

async function executeOwned(
  input: TaskExecutionInput,
  session: TaskOperationJournalSession,
): Promise<TaskExecutionResult> {
  const { plan } = input;
  let record = await session.read();
  const digest = taskExecutionPlanDigest(plan);
  if (record !== undefined && record.planDigest !== digest)
    return result(plan, "conflict", record.taskId, "operation-id-reused");
  if (record?.phase === "rejected")
    return result(plan, "failed", record.taskId, "provider-rejected");
  if (record?.phase === "applied" || record?.phase === "verified")
    return finish(input, session, record);
  if (record?.phase === "uncertain") {
    if (record.taskId === null)
      return result(plan, "uncertain", null, "unknown-create-outcome");
    return verifyAndFinish(input, session, record);
  }
  let register: TaskRegister | undefined;
  let live: LiveTask[];
  try {
    register = await input.target.registerStore.read();
    if (register?.listId !== plan.listId)
      return result(plan, "conflict", null, "list-mismatch");
    live = await input.reader.listTasks({ listId: plan.listId });
    if (taskExecutionSnapshot(live) !== plan.expectedSnapshot)
      return result(plan, "conflict", null, "stale-snapshot");
    const conflict = existingTaskConflict(plan, register, live);
    if (conflict !== undefined) return result(plan, "conflict", null, conflict);
    const checked = await input.checks?.beforeWrite?.({ plan, live, register });
    if (checked !== undefined) return result(plan, "conflict", null, checked);
  } catch {
    return result(plan, "conflict", null, "preflight-unavailable");
  }
  record ??= {
    schemaVersion: 1,
    plan,
    planDigest: digest,
    phase: "prepared",
    taskId: plan.operation.name === "create" ? null : plan.operation.taskId,
  };
  try {
    await session.write(record);
    record = { ...record, phase: "uncertain" };
    await session.write(record);
  } catch {
    return result(plan, "failed", record.taskId, "journal-before-send-failed");
  }
  try {
    const taskId = await send(input);
    record = { ...record, taskId };
  } catch (error) {
    if (definitiveRejection(error)) {
      try {
        await session.write({ ...record, phase: "rejected" });
      } catch {
        return result(
          plan,
          "uncertain",
          record.taskId,
          "journal-after-send-failed",
        );
      }
      return result(plan, "failed", record.taskId, "provider-rejected");
    }
    return result(plan, "uncertain", record.taskId, "provider-outcome-unknown");
  }
  try {
    await session.write(record);
  } catch {
    return result(
      plan,
      "uncertain",
      record.taskId,
      "journal-after-send-failed",
    );
  }
  return verifyAndFinish(input, session, record);
}

function existingTaskConflict(
  plan: TaskExecutionPlan,
  register: TaskRegister,
  live: LiveTask[],
): string | undefined {
  if (plan.operation.name === "create") return undefined;
  const id = plan.operation.taskId;
  const row = register.tasks.find((task) => task.taskId === id);
  const provider = live.find((task) => task.id === id);
  if (row === undefined) return "unregistered-task";
  if (
    row.status === "cancelled" ||
    provider === undefined ||
    provider.deleted === true
  )
    return "task-cancelled";
  if (row.status === "completed" || provider.status === "completed")
    return "task-completed";
  return undefined;
}

async function send(input: TaskExecutionInput): Promise<string> {
  const { plan, writer } = input;
  const operation = plan.operation;
  if (operation.name === "create") {
    const created = await writer.createTask({
      listId: plan.listId,
      task: { title: operation.title, ...fields(plan) },
    });
    if (typeof created.id !== "string" || created.id === "")
      throw new Error("Provider returned no task identity.");
    return created.id;
  }
  if (operation.name === "cancel")
    await writer.deleteTask({ listId: plan.listId, taskId: operation.taskId });
  else
    await writer.patchTask({
      listId: plan.listId,
      taskId: operation.taskId,
      patch: fields(plan),
    });
  return operation.taskId;
}

async function verifyAndFinish(
  input: TaskExecutionInput,
  session: TaskOperationJournalSession,
  record: TaskOperationJournalRecord,
): Promise<TaskExecutionResult> {
  const { plan } = input;
  if (record.taskId === null)
    return result(plan, "uncertain", null, "unknown-create-outcome");
  let live: LiveTask | undefined;
  try {
    live = await input.writer.readTask({
      listId: plan.listId,
      taskId: record.taskId,
    });
  } catch {
    return result(plan, "uncertain", record.taskId, "readback-unavailable");
  }
  if (!matches(plan, record.taskId, live))
    return result(plan, "uncertain", record.taskId, "readback-conflict");
  const verified: TaskOperationJournalRecord = { ...record, phase: "verified" };
  try {
    await session.write(verified);
  } catch {
    return result(
      plan,
      "uncertain",
      record.taskId,
      "journal-verification-failed",
    );
  }
  return finish(input, session, verified);
}

async function finish(
  input: TaskExecutionInput,
  session: TaskOperationJournalSession,
  record: TaskOperationJournalRecord,
): Promise<TaskExecutionResult> {
  const { plan } = input;
  const taskId = record.taskId;
  if (taskId === null)
    return result(plan, "uncertain", null, "unknown-create-outcome");
  let live: LiveTask[];
  try {
    const register = await input.target.registerStore.read();
    if (register?.listId !== plan.listId)
      return result(plan, "uncertain", taskId, "local-list-conflict");
    live = await input.reader.listTasks({ listId: plan.listId });
    taskExecutionSnapshot(live);
    if (
      !matches(
        plan,
        taskId,
        live.find((task) => task.id === taskId),
      )
    )
      return result(plan, "uncertain", taskId, "final-snapshot-conflict");
    const recovered = recoverProvenance(register, plan, taskId);
    await input.target.registerStore.write(
      mergeLiveTasks(recovered, live).register,
    );
    const refreshed = await refreshTaskTargetSnapshot(input.target, {
      listTasks: async () => live,
    });
    if (refreshed.report.freshness !== "fresh")
      return result(plan, "uncertain", taskId, "local-recording-unverified");
  } catch {
    return result(plan, "uncertain", taskId, "local-recording-failed");
  }
  try {
    await input.checks?.afterApplied?.({ plan, taskId, live });
  } catch {
    return result(plan, "uncertain", taskId, "lifecycle-recording-failed");
  }
  try {
    await session.write({ ...record, phase: "applied" });
  } catch {
    return result(plan, "uncertain", taskId, "journal-completion-failed");
  }
  return {
    schemaVersion: 1,
    operationId: plan.operationId,
    outcome: "applied",
    taskId,
    registerFresh: true,
  };
}

function recoverProvenance(
  register: TaskRegister,
  plan: TaskExecutionPlan,
  taskId: string,
): TaskRegister {
  if (plan.operation.name !== "create") return register;
  const operation = plan.operation;
  const current = register.tasks.find((task) => task.taskId === taskId);
  if (current === undefined)
    return {
      ...register,
      tasks: [
        ...register.tasks,
        {
          taskId,
          title: operation.title,
          status: "open",
          ...(operation.provenance === undefined
            ? {}
            : { provenance: operation.provenance }),
        },
      ],
    };
  if (operation.provenance === undefined) return register;
  const provenance = { ...current.provenance };
  for (const [key, value] of Object.entries(operation.provenance)) {
    const existing = Reflect.get(provenance, key);
    if (existing !== undefined && existing !== value)
      throw new Error("Local task provenance changed.");
    Reflect.set(provenance, key, value);
  }
  return {
    ...register,
    tasks: register.tasks.map((task) =>
      task.taskId === taskId ? { ...task, provenance } : task,
    ),
  };
}

function fields(plan: TaskExecutionPlan): LiveTaskFields {
  const operation = plan.operation;
  if (operation.name === "complete") return { status: "completed" };
  if (operation.name === "cancel") return {};
  return {
    ...(operation.title === undefined ? {} : { title: operation.title }),
    ...(operation.doDate === undefined
      ? {}
      : { due: liveDue(operation.doDate) }),
  };
}

function matches(
  plan: TaskExecutionPlan,
  taskId: string,
  live: LiveTask | undefined,
): boolean {
  if (plan.operation.name === "cancel")
    return live === undefined || (live.id === taskId && live.deleted === true);
  if (live === undefined || live.id !== taskId || live.deleted === true)
    return false;
  const expected = fields(plan);
  return (
    (expected.title === undefined || live.title === expected.title) &&
    (expected.due === undefined ||
      liveDoDate(live.due) === liveDoDate(expected.due)) &&
    (expected.status === undefined || live.status === expected.status)
  );
}

function definitiveRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; response?: { status?: unknown } };
  const status = value.response?.status ?? value.code;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

function result(
  plan: TaskExecutionPlan,
  outcome: TaskExecutionResult["outcome"],
  taskId: string | null,
  code: string,
): TaskExecutionResult {
  return {
    schemaVersion: 1,
    operationId: plan.operationId,
    outcome,
    taskId,
    registerFresh: false,
    code,
  };
}
