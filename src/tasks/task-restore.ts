import { isDeepStrictEqual } from "node:util";
import {
  TaskRestoreClaimError,
  TaskRestoreOwnershipError,
} from "./file-task-restore-journal.js";
import { refreshTaskTargetSnapshot } from "./refresh-task-registers.js";
import {
  parseTaskLifecycleState,
  sameTaskProviderIdentity,
  type TaskLifecycleEntry,
  type TaskLifecycleState,
  type TaskProviderIdentity,
} from "./task-lifecycle.js";
import { taskExecutionSnapshot } from "./task-execution-plan.js";
import {
  parseTaskRestorePlan,
  taskRestorePlanDigest,
} from "./task-restore-plan.js";
import type { TaskRecoverySnapshot } from "./task-recovery-types.js";
import type {
  TaskRestoreInput,
  TaskRestoreJournalRecord,
  TaskRestoreJournalSession,
  TaskRestorePlan,
  TaskRestoreResult,
} from "./task-restore-types.js";
import type { LiveTask, TaskRegister, TaskRegisterEntry } from "./types.js";

interface RestoreSource {
  task: LiveTask & { title: string };
  row?: TaskRegisterEntry;
  historicalEntry?: TaskLifecycleEntry;
  currentEntry?: TaskLifecycleEntry;
  identities: TaskProviderIdentity[];
  originalIdentities: TaskProviderIdentity[];
}
class RestoreRefusal extends Error {
  constructor(
    readonly code: string,
    readonly unsupportedFields?: string[],
  ) {
    super(code);
  }
}

export async function executeTaskRestore(
  input: TaskRestoreInput,
): Promise<TaskRestoreResult> {
  let plan: TaskRestorePlan;
  try {
    plan = parseTaskRestorePlan(input.plan);
  } catch {
    return result(
      {
        operationId: "invalid",
        originalTaskId: "invalid",
        snapshotId: "invalid",
      },
      "conflict",
      null,
      "invalid-plan",
    );
  }
  if (!isDeepStrictEqual(plan.target, input.target.identity))
    return result(plan, "conflict", null, "target-mismatch");
  let completed: TaskRestoreResult | undefined;
  try {
    return await input.recovery.withSnapshot(plan.snapshotId, (snapshot) =>
      input.journal.withOwner(
        {
          operationId: plan.operationId,
          listId: plan.listId,
          target: plan.target,
          originalTaskId: plan.originalTaskId,
          sourceOccurrenceId: plan.sourceOccurrenceId,
        },
        async (session) => {
          completed = await executeOwned({ ...input, plan }, snapshot, session);
          return completed;
        },
      ),
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
      error instanceof TaskRestoreOwnershipError ||
        error instanceof TaskRestoreClaimError
        ? "conflict"
        : "failed",
      null,
      error instanceof TaskRestoreOwnershipError
        ? "owner-busy"
        : error instanceof TaskRestoreClaimError
          ? "restore-identity-reserved"
          : "recovery-or-journal-unavailable",
    );
  }
}

async function executeOwned(
  input: TaskRestoreInput,
  snapshot: TaskRecoverySnapshot,
  session: TaskRestoreJournalSession,
): Promise<TaskRestoreResult> {
  const { plan } = input;
  const digest = taskRestorePlanDigest(plan);
  let record = await session.read();
  if (record !== undefined && record.planDigest !== digest)
    return result(plan, "conflict", record.taskId, "operation-id-reused");
  if (record?.phase === "rejected")
    return result(plan, "failed", null, "provider-rejected");
  if (record?.phase === "sending" && record.taskId === null)
    return result(plan, "uncertain", null, "unknown-create-outcome");
  if (record?.taskId !== undefined && record.taskId !== null)
    return verifyAndFinish(input, snapshot, session, record);
  let register: TaskRegister;
  let live: LiveTask[];
  let state: TaskLifecycleState;
  let source: RestoreSource;
  try {
    const current = await input.target.registerStore.read();
    if (current?.listId !== plan.listId) refuse("list-mismatch");
    register = current;
    live = await input.reader.listTasks({ listId: plan.listId });
    if (taskExecutionSnapshot(live) !== plan.expectedSnapshot)
      refuse("stale-snapshot");
    state = parseTaskLifecycleState(await input.lifecycle.read());
    if (state.revision !== plan.expectedLifecycleRevision)
      refuse("stale-lifecycle");
    source = restoreSource(snapshot, plan, state);
    await assertMissing(input, source, live);
  } catch (error) {
    return refused(plan, error, "preflight-unavailable");
  }
  if (input.apply !== true) return result(plan, "preview", null);
  try {
    await input.recovery.capture({
      target: plan.target,
      listId: plan.listId,
      register,
      live,
      reason: "before-operation",
      lifecycle: state,
      operation: {
        operationId: plan.operationId,
        planDigest: digest,
        phase: "before-restore",
        taskId: null,
        sourceOccurrenceId: plan.sourceOccurrenceId,
      },
    });
    const current = await input.target.registerStore.read();
    if (
      current?.listId !== plan.listId ||
      !isDeepStrictEqual(current, register)
    )
      refuse("register-changed");
    if (
      taskExecutionSnapshot(
        await input.reader.listTasks({ listId: plan.listId }),
      ) !== plan.expectedSnapshot
    )
      refuse("stale-snapshot");
    const latest = parseTaskLifecycleState(await input.lifecycle.read());
    if (latest.revision !== plan.expectedLifecycleRevision)
      refuse("stale-lifecycle");
  } catch (error) {
    return refused(plan, error, "pre-restore-backup-failed");
  }
  record ??= {
    schemaVersion: 1,
    plan,
    planDigest: digest,
    phase: "prepared",
    taskId: null,
  };
  try {
    await input.recovery.retain(
      plan.snapshotId,
      `task-restore:${plan.operationId}`,
    );
    await session.write(record);
    record = { ...record, phase: "sending" };
    await session.write(record);
  } catch {
    return result(plan, "failed", null, "journal-before-send-failed");
  }
  try {
    const created = await input.writer.createTask({
      listId: plan.listId,
      task: {
        title: source.task.title,
        status:
          source.task.status === "completed" ? "completed" : "needsAction",
      },
    });
    if (
      typeof created.id !== "string" ||
      created.id.trim() === "" ||
      created.id.includes("\0")
    )
      throw new Error("Provider did not return a Task ID.");
    record = { ...record, taskId: created.id };
  } catch (error) {
    if (definitiveRejection(error)) {
      try {
        await session.write({ ...record, phase: "rejected" });
      } catch {
        return result(plan, "uncertain", null, "journal-after-send-failed");
      }
      await input.recovery.release(
        plan.snapshotId,
        `task-restore:${plan.operationId}`,
      );
      return result(plan, "failed", null, "provider-rejected");
    }
    return result(plan, "uncertain", null, "provider-outcome-unknown");
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
  return verifyAndFinish(input, snapshot, session, record);
}

async function verifyAndFinish(
  input: TaskRestoreInput,
  snapshot: TaskRecoverySnapshot,
  session: TaskRestoreJournalSession,
  record: TaskRestoreJournalRecord,
): Promise<TaskRestoreResult> {
  const { plan } = input;
  const taskId = record.taskId;
  if (taskId === null)
    return result(plan, "uncertain", null, "unknown-create-outcome");
  let source: RestoreSource;
  let live: LiveTask[];
  let register: TaskRegister;
  let state: TaskLifecycleState;
  try {
    state = parseTaskLifecycleState(await input.lifecycle.read());
    source = restoreSource(snapshot, plan, state);
    if (
      source.originalIdentities.some(
        (identity) =>
          identity.listId === plan.listId && identity.taskId === taskId,
      )
    )
      refuse("provider-id-reused");
    const readback = await input.writer.readTask({
      listId: plan.listId,
      taskId,
    });
    if (!matches(source, taskId, readback)) refuse("readback-conflict");
    const current = await input.target.registerStore.read();
    if (current?.listId !== plan.listId) refuse("list-mismatch");
    register = current;
    live = await input.reader.listTasks({ listId: plan.listId });
    taskExecutionSnapshot(live);
    if (
      !matches(
        source,
        taskId,
        live.find((task) => task.id === taskId),
      )
    )
      refuse("final-snapshot-conflict");
    await assertMissing(input, source, live, taskId);
  } catch (error) {
    const response = refused(plan, error, "readback-unavailable", taskId);
    return {
      ...response,
      outcome:
        response.code === "readback-unavailable" ? "uncertain" : "conflict",
    };
  }
  if (input.apply !== true) return result(plan, "preview", taskId);
  if (record.phase !== "applied") {
    try {
      record = { ...record, phase: "verified" };
      await session.write(record);
    } catch {
      return result(plan, "uncertain", taskId, "journal-verification-failed");
    }
  }
  try {
    const withProvenance = restoreProvenance(register, source, taskId);
    if (!isDeepStrictEqual(register, withProvenance))
      await input.target.registerStore.write(withProvenance);
    const refreshed = await refreshTaskTargetSnapshot(input.target, {
      listTasks: async () => live,
    });
    if (refreshed.report.freshness !== "fresh")
      return result(plan, "uncertain", taskId, "local-recording-unverified");
    const previous = source.currentEntry ?? source.historicalEntry;
    const binding = { canonical: { listId: plan.listId, taskId }, aliases: [] };
    const hasBinding = previous?.providers.some((item) =>
      sameTaskProviderIdentity(item.canonical, binding.canonical),
    );
    const completed = source.task.status === "completed";
    const entry: TaskLifecycleEntry =
      previous === undefined
        ? {
            target: { kind: plan.target.kind, key: plan.target.key },
            occurrenceId: plan.sourceOccurrenceId,
            source: {
              kind: "provider",
              id: JSON.stringify([plan.listId, plan.originalTaskId]),
            },
            disposition: completed ? "completed" : "active",
            recordedAt: new Date().toISOString(),
            evidenceRef: `task-restore:${plan.operationId}:${plan.ownerApprovalRef}`,
            providers: [
              {
                canonical: { listId: plan.listId, taskId: plan.originalTaskId },
                aliases: [],
              },
              binding,
            ],
          }
        : {
            ...previous,
            providers: hasBinding
              ? previous.providers
              : [...previous.providers, binding],
          };
    await input.lifecycle.record(entry);
  } catch {
    return result(plan, "uncertain", taskId, "local-reconciliation-failed");
  }
  try {
    await session.write({ ...record, phase: "applied" });
  } catch {
    return result(plan, "uncertain", taskId, "journal-completion-failed");
  }
  try {
    await input.recovery.release(
      plan.snapshotId,
      `task-restore:${plan.operationId}`,
    );
  } catch {
    return result(plan, "uncertain", taskId, "recovery-release-failed");
  }
  return { ...result(plan, "applied", taskId), registerFresh: true };
}

function restoreSource(
  snapshot: TaskRecoverySnapshot,
  plan: TaskRestorePlan,
  state: TaskLifecycleState,
): RestoreSource {
  if (
    snapshot.snapshotId !== plan.snapshotId ||
    snapshot.listId !== plan.listId ||
    !isDeepStrictEqual(snapshot.target, plan.target) ||
    snapshot.register.listId !== plan.listId
  )
    refuse("snapshot-target-mismatch");
  taskExecutionSnapshot(snapshot.live);
  const task = snapshot.live.find((item) => item.id === plan.originalTaskId);
  if (
    task === undefined ||
    task.deleted === true ||
    typeof task.title !== "string" ||
    task.title.trim() === ""
  )
    refuse("historical-task-unavailable");
  const rows = snapshot.register.tasks.filter(
    (item) => item.taskId === plan.originalTaskId,
  );
  if (rows.length > 1) refuse("ambiguous-historical-register");
  const row = rows[0];
  const identity = { listId: plan.listId, taskId: plan.originalTaskId };
  const historicalState =
    snapshot.lifecycle === undefined
      ? undefined
      : parseTaskLifecycleState(snapshot.lifecycle);
  const nativeGroups =
    snapshot.nativeTiming.status === "observed"
      ? snapshot.nativeTiming.tasks.map((item) => [
          item.identity.canonical,
          ...item.identity.aliases.map((alias) => alias.identity),
        ])
      : [];
  const historicalGroups = (historicalState?.entries ?? [])
    .filter((entry) => sameTarget(entry, plan))
    .map(identities);
  let candidates = relatedIdentities(identity, [
    ...historicalGroups,
    ...nativeGroups,
    ...state.entries.filter((entry) => sameTarget(entry, plan)).map(identities),
  ]);
  const byProvider = (entry: TaskLifecycleEntry): boolean =>
    sameTarget(entry, plan) &&
    identities(entry).some((candidate) =>
      candidates.some((item) => sameTaskProviderIdentity(candidate, item)),
    );
  const historical = historicalState?.entries.filter(byProvider) ?? [];
  const current = state.entries.filter(byProvider);
  const known = new Set([
    ...(snapshot.sources ?? [])
      .filter((item) => item.taskId === plan.originalTaskId)
      .map((item) => item.sourceOccurrenceId),
    ...historical.map((entry) => entry.occurrenceId),
    ...current.map((entry) => entry.occurrenceId),
  ]);
  if (known.size > 1) refuse("ambiguous-source-occurrence");
  const occurrence =
    [...known][0] ??
    `provider:${JSON.stringify([plan.listId, plan.originalTaskId])}`;
  if (plan.sourceOccurrenceId !== occurrence)
    refuse("source-occurrence-mismatch");
  const historicalEntry = historicalState?.entries.find(
    (entry) => sameTarget(entry, plan) && entry.occurrenceId === occurrence,
  );
  const currentEntry = state.entries.find(
    (entry) => sameTarget(entry, plan) && entry.occurrenceId === occurrence,
  );
  const originalIdentities = relatedIdentities(identity, [
    ...historicalGroups,
    ...nativeGroups,
    [identity, ...identities(historicalEntry)],
  ]);
  candidates = relatedIdentities(identity, [
    ...historicalGroups,
    ...nativeGroups,
    ...state.entries.filter((entry) => sameTarget(entry, plan)).map(identities),
    [identity, ...identities(historicalEntry), ...identities(currentEntry)],
  ]);
  for (const entry of [historicalEntry, currentEntry]) {
    if (entry?.disposition === "owner-dismissed") refuse("owner-dismissed");
    if (entry?.disposition === "completed" && task.status !== "completed")
      refuse("task-completed");
  }
  if (
    historicalEntry !== undefined &&
    currentEntry !== undefined &&
    !isDeepStrictEqual(historicalEntry.source, currentEntry.source)
  )
    refuse("source-identity-changed");
  if (
    historicalEntry?.disposition === "completed" &&
    currentEntry?.disposition === "active"
  )
    refuse("completed-lifecycle-evidence-conflict");
  const unsupported = [
    ...(task.assignmentInfo === undefined ? [] : ["assignmentInfo"]),
    ...((task.notes !== undefined && task.notes !== "") ||
    (row?.notes !== undefined && row.notes !== "")
      ? ["notes"]
      : []),
    ...(task.parent !== undefined && task.parent !== "" ? ["parent"] : []),
    ...(snapshot.live.some((item) => item.parent === plan.originalTaskId)
      ? ["hierarchy"]
      : []),
  ];
  if (unsupported.length > 0)
    throw new RestoreRefusal("unsupported-fields", unsupported);
  if ((task.due !== undefined && task.due !== "") || row?.doDate !== undefined)
    throw new RestoreRefusal("native-timing-unavailable", ["due"]);
  if (
    snapshot.nativeTiming.status === "observed" &&
    snapshot.nativeTiming.tasks.some(
      (item) =>
        item.timing !== null &&
        [
          item.identity.canonical,
          ...item.identity.aliases.map((alias) => alias.identity),
        ].some((candidate) =>
          candidates.some((original) =>
            sameTaskProviderIdentity(original, candidate),
          ),
        ),
    )
  )
    refuse("native-timing-unavailable");
  return {
    task: { ...task, title: task.title },
    ...(row === undefined ? {} : { row }),
    ...(historicalEntry === undefined ? {} : { historicalEntry }),
    ...(currentEntry === undefined ? {} : { currentEntry }),
    identities: candidates,
    originalIdentities,
  };
}

async function assertMissing(
  input: TaskRestoreInput,
  source: RestoreSource,
  live: LiveTask[],
  restoredTaskId?: string,
): Promise<void> {
  const { plan } = input;
  const lists = new Map<string, LiveTask[]>([[plan.listId, live]]);
  for (const identity of source.identities) {
    if (identity.listId === plan.listId && identity.taskId === restoredTaskId)
      continue;
    let tasks = lists.get(identity.listId);
    if (tasks === undefined) {
      tasks = await input.reader.listTasks({ listId: identity.listId });
      taskExecutionSnapshot(tasks);
      lists.set(identity.listId, tasks);
    }
    if (
      tasks.some((task) => task.id === identity.taskId && task.deleted !== true)
    )
      refuse(
        identity.taskId === plan.originalTaskId &&
          identity.listId === plan.listId
          ? "original-task-exists"
          : "bound-provider-exists",
      );
  }
  if (
    live.some(
      (task) =>
        task.deleted !== true &&
        task.id !== restoredTaskId &&
        normalizedTitle(task.title ?? "") ===
          normalizedTitle(source.task.title),
    )
  )
    refuse("possible-duplicate-title");
}

function restoreProvenance(
  register: TaskRegister,
  source: RestoreSource,
  taskId: string,
): TaskRegister {
  const rows = register.tasks.filter((item) => item.taskId === taskId);
  if (rows.length > 1) refuse("ambiguous-restored-register");
  const current = rows[0];
  if (
    current !== undefined &&
    (current.title !== source.task.title ||
      current.status !==
        (source.task.status === "completed" ? "completed" : "open") ||
      current.doDate !== undefined ||
      (current.notes !== undefined && current.notes !== ""))
  )
    refuse("restored-register-changed");
  const provenance = { ...current?.provenance };
  for (const [key, value] of Object.entries(source.row?.provenance ?? {})) {
    if (
      Reflect.get(provenance, key) !== undefined &&
      Reflect.get(provenance, key) !== value
    )
      refuse("restored-provenance-changed");
    Reflect.set(provenance, key, value);
  }
  const row: TaskRegisterEntry = {
    taskId,
    title: source.task.title,
    status: source.task.status === "completed" ? "completed" : "open",
    ...(Object.keys(provenance).length === 0 ? {} : { provenance }),
  };
  const original: TaskRegisterEntry =
    source.row === undefined
      ? {
          taskId: source.task.id,
          title: source.task.title,
          status: "cancelled",
        }
      : { ...source.row, taskId: source.task.id, status: "cancelled" };
  const retained = register.tasks.some((item) => item.taskId === source.task.id)
    ? register.tasks
    : [...register.tasks, original];
  return {
    ...register,
    tasks:
      current === undefined
        ? [...retained, row]
        : retained.map((item) =>
            item.taskId === taskId ? { ...item, ...row } : item,
          ),
  };
}
function matches(
  source: RestoreSource,
  taskId: string,
  task: LiveTask | undefined,
): boolean {
  return (
    task !== undefined &&
    task.id === taskId &&
    task.deleted !== true &&
    task.title === source.task.title &&
    (task.status ?? "needsAction") === (source.task.status ?? "needsAction") &&
    (task.notes === undefined || task.notes === "") &&
    (task.due === undefined || task.due === "") &&
    (task.parent === undefined || task.parent === "")
  );
}
function relatedIdentities(
  initial: TaskProviderIdentity,
  groups: TaskProviderIdentity[][],
): TaskProviderIdentity[] {
  const key = (identity: TaskProviderIdentity): string =>
    JSON.stringify([identity.listId, identity.taskId]);
  const byIdentity = new Map<string, TaskProviderIdentity[][]>();
  for (const group of groups)
    for (const identity of group) {
      const related = byIdentity.get(key(identity)) ?? [];
      related.push(group);
      byIdentity.set(key(identity), related);
    }
  const found = new Map<string, TaskProviderIdentity>([
    [key(initial), initial],
  ]);
  const queue = [initial];
  const visited = new Set<TaskProviderIdentity[]>();
  for (let index = 0; index < queue.length; index += 1) {
    const identity = queue[index];
    if (identity === undefined) continue;
    for (const group of byIdentity.get(key(identity)) ?? []) {
      if (visited.has(group)) continue;
      visited.add(group);
      for (const candidate of group)
        if (!found.has(key(candidate))) {
          found.set(key(candidate), candidate);
          queue.push(candidate);
        }
    }
  }
  return [...found.values()];
}
function identities(
  entry: TaskLifecycleEntry | undefined,
): TaskProviderIdentity[] {
  return (
    entry?.providers.flatMap((binding) => [
      binding.canonical,
      ...binding.aliases.map((alias) => alias.identity),
    ]) ?? []
  );
}
function sameTarget(entry: TaskLifecycleEntry, plan: TaskRestorePlan): boolean {
  return (
    entry.target.kind === plan.target.kind &&
    entry.target.key === plan.target.key
  );
}
function normalizedTitle(title: string): string {
  return title.trim().normalize("NFKC").toLocaleLowerCase("en");
}
function refuse(code: string): never {
  throw new RestoreRefusal(code);
}
function refused(
  plan: TaskRestorePlan,
  error: unknown,
  fallback: string,
  taskId: string | null = null,
): TaskRestoreResult {
  return {
    ...result(
      plan,
      error instanceof RestoreRefusal ? "conflict" : "failed",
      taskId,
      error instanceof RestoreRefusal ? error.code : fallback,
    ),
    ...(error instanceof RestoreRefusal && error.unsupportedFields !== undefined
      ? { unsupportedFields: error.unsupportedFields }
      : {}),
  };
}
function result(
  plan: Pick<TaskRestorePlan, "operationId" | "originalTaskId" | "snapshotId">,
  outcome: TaskRestoreResult["outcome"],
  taskId: string | null,
  code?: string,
): TaskRestoreResult {
  return {
    schemaVersion: 1,
    operationId: plan.operationId,
    outcome,
    taskId,
    originalTaskId: plan.originalTaskId,
    newTaskId: taskId,
    snapshotId: plan.snapshotId,
    registerFresh: false,
    nativeTimingRestored: false,
    identityHistoryRestored: false,
    ...(code === undefined ? {} : { code }),
  };
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
