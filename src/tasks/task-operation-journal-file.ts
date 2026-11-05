import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { sha256 } from "../checksum.js";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import {
  parseTaskExecutionPlan,
  taskExecutionPlanDigest,
} from "./task-execution-plan.js";
import type { TaskTargetIdentity } from "./types.js";
import type {
  TaskOperationJournal,
  TaskOperationJournalRecord,
} from "./task-execution-types.js";

export class TaskOperationOwnershipError extends Error {
  readonly code = "owner-busy";
}
export class TaskOperationOccurrenceError extends Error {
  readonly code = "source-occurrence-reserved";
}

export function createFileTaskOperationJournal(
  stateRoot: string,
): TaskOperationJournal {
  return {
    withOwner: async (scope, run) => {
      const requested = join(stateRoot, "task-operations");
      await mkdir(requested, { recursive: true, mode: 0o700 });
      const metadata = await lstat(requested);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o777) !== 0o700
      )
        throw new Error(
          "Task operation storage must be an ordinary private directory.",
        );
      const directory = await realpath(requested);
      const sourceKey =
        scope.sourceOccurrence === undefined
          ? undefined
          : sha256(
              JSON.stringify([
                scope.sourceOccurrence.target.kind,
                scope.sourceOccurrence.target.key,
                scope.sourceOccurrence.id,
              ]),
            );
      const sourcePath =
        sourceKey === undefined
          ? undefined
          : join(directory, `source-${sourceKey}.json`);
      const keys = [
        `list:${scope.listId}`,
        `operation:${scope.operationId}`,
        ...(sourceKey === undefined ? [] : [`source:${sourceKey}`]),
      ].sort();
      for (const key of keys) {
        try {
          await lstat(join(directory, `${sha256(key)}.lock`));
          throw new TaskOperationOwnershipError(
            "Legacy task ownership evidence requires explicit reconciliation.",
          );
        } catch (error) {
          if (!hasCode(error, "ENOENT")) throw error;
        }
      }
      return withOwners(
        directory,
        keys.map((key) => join(directory, `owner-${sha256(key)}.journal`)),
        async () => {
          if (sourceKey !== undefined) {
            const claim = await lstat(
              join(directory, `restore-source-${sourceKey}.json`),
            ).catch((error: unknown) => {
              if (hasCode(error, "ENOENT")) return undefined;
              throw error;
            });
            if (claim !== undefined)
              throw new TaskOperationOccurrenceError(
                "A restore already reserves this exact source occurrence; reconcile its original receipt.",
              );
          }
          if (sourcePath !== undefined)
            await checkOccurrence(sourcePath, scope.operationId);
          const path = join(directory, `${sha256(scope.operationId)}.json`);
          const read = async () => {
            try {
              const info = await lstat(path);
              if (!info.isFile() || info.isSymbolicLink())
                throw new Error("Task journal must be an ordinary file.");
              return parseJournal(JSON.parse(await readFile(path, "utf8")));
            } catch (error) {
              if (hasCode(error, "ENOENT")) return undefined;
              throw error;
            }
          };
          let active = true;
          let pending: Promise<unknown> = Promise.resolve();
          const admitted: Promise<unknown>[] = [];
          const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
            if (!active)
              return Promise.reject(
                new Error("Task operation ownership has ended."),
              );
            const next = pending.then(operation);
            pending = next;
            admitted.push(next);
            void next.catch(() => undefined);
            return next;
          };
          let outcome:
            | { ok: true; value: Awaited<ReturnType<typeof run>> }
            | { ok: false; error: unknown };
          try {
            outcome = {
              ok: true,
              value: await run({
                read: () => enqueue(read),
                write: (record) => {
                  const captured = structuredClone(record);
                  return enqueue(async () => {
                    const checked = parseJournal(captured);
                    if (
                      checked.plan.operationId !== scope.operationId ||
                      checked.plan.listId !== scope.listId
                    )
                      throw new Error("Task journal scope mismatch.");
                    const previous = await read();
                    assertTransition(previous, checked);
                    if (sourcePath !== undefined) {
                      await checkOccurrence(sourcePath, scope.operationId);
                      await replaceSynced(
                        directory,
                        sourcePath,
                        JSON.stringify({ operationId: scope.operationId }),
                      );
                    }
                    await replaceSynced(
                      directory,
                      path,
                      JSON.stringify(checked),
                    );
                  });
                },
              }),
            };
          } catch (error) {
            outcome = { ok: false, error };
          } finally {
            active = false;
          }
          const settled = await Promise.allSettled(admitted);
          if (!outcome.ok) throw outcome.error;
          const failed = settled.find((item) => item.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          return outcome.value;
        },
      );
    },
  };
}

async function withOwners<T>(
  stateRoot: string,
  paths: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  const [path, ...remaining] = paths;
  if (path === undefined) return run();
  const owned = await withJournalMutationOwner(
    { stateRoot, journalPath: path },
    () => withOwners(stateRoot, remaining, run),
  );
  if (owned.kind === "refused") {
    if (owned.reason === "busy")
      throw new TaskOperationOwnershipError(owned.evidence);
    throw new Error(owned.evidence);
  }
  return owned.value;
}

function parseJournal(value: unknown): TaskOperationJournalRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid task journal.");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        !["schemaVersion", "plan", "planDigest", "phase", "taskId"].includes(
          key,
        ),
    )
  )
    throw new Error("Unknown task journal field.");
  const plan = parseTaskExecutionPlan(record.plan);
  const phase = record.phase;
  if (
    record.schemaVersion !== 1 ||
    record.planDigest !== taskExecutionPlanDigest(plan) ||
    !["prepared", "uncertain", "verified", "applied", "rejected"].includes(
      String(phase),
    ) ||
    !(
      record.taskId === null ||
      (typeof record.taskId === "string" && record.taskId.length > 0)
    )
  )
    throw new Error("Invalid task journal evidence.");
  if ((phase === "verified" || phase === "applied") && record.taskId === null)
    throw new Error("Verified task journal has no identity.");
  return {
    schemaVersion: 1,
    plan,
    planDigest: record.planDigest,
    phase: phase as TaskOperationJournalRecord["phase"],
    taskId: record.taskId,
  };
}

function assertTransition(
  previous: TaskOperationJournalRecord | undefined,
  next: TaskOperationJournalRecord,
): void {
  if (previous === undefined) {
    if (next.phase !== "prepared")
      throw new Error("Task journal must begin before sending.");
    return;
  }
  if (
    previous.planDigest !== next.planDigest ||
    (previous.taskId !== null && previous.taskId !== next.taskId)
  )
    throw new Error("Task journal identity changed.");
  const allowed: Record<
    TaskOperationJournalRecord["phase"],
    readonly TaskOperationJournalRecord["phase"][]
  > = {
    prepared: ["prepared", "uncertain", "verified", "rejected"],
    uncertain: ["uncertain", "verified", "rejected"],
    verified: ["verified", "applied"],
    applied: ["applied"],
    rejected: ["rejected"],
  };
  if (!allowed[previous.phase].includes(next.phase))
    throw new Error("Task journal cannot rewind execution.");
}

async function replaceSynced(
  directory: string,
  path: string,
  contents: string,
): Promise<void> {
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    if ((await readFile(path, "utf8")) !== contents)
      throw new Error("Task journal publication did not verify.");
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}

async function checkOccurrence(
  path: string,
  operationId: string,
): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Invalid source occurrence reservation.");
    const reserved: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof reserved !== "object" ||
      reserved === null ||
      Array.isArray(reserved) ||
      Object.keys(reserved).length !== 1 ||
      typeof Reflect.get(reserved, "operationId") !== "string"
    )
      throw new Error("Invalid source occurrence reservation.");
    const previousId = Reflect.get(reserved, "operationId") as string;
    if (previousId !== operationId) {
      const previousPath = join(dirname(path), `${sha256(previousId)}.json`);
      const previousInfo = await lstat(previousPath).catch(() => {
        throw new Error(
          "Prior source journal is unavailable; retain its reservation.",
        );
      });
      if (!previousInfo.isFile() || previousInfo.isSymbolicLink())
        throw new Error("Invalid prior source operation evidence.");
      const previousBytes = await readFile(previousPath, "utf8").catch(() => {
        throw new Error(
          "Prior source journal is unavailable; retain its reservation.",
        );
      });
      const previous = parseJournal(JSON.parse(previousBytes));
      const occurrence = previous.plan.sourceOccurrenceId;
      const expectedName =
        occurrence === undefined
          ? undefined
          : `source-${sha256(JSON.stringify([previous.plan.target.kind, previous.plan.target.key, occurrence]))}.json`;
      if (
        previous.plan.operationId !== previousId ||
        previous.plan.operation.name !== "create" ||
        basename(path) !== expectedName
      )
        throw new Error(
          "Prior source reservation does not match its exact journal.",
        );
      if (
        previous.taskId !== null ||
        (previous.phase !== "prepared" && previous.phase !== "rejected")
      )
        throw new TaskOperationOccurrenceError(
          "A source occurrence already belongs to an operation that may have applied.",
        );
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

export interface TaskCreationSource {
  sourceOccurrenceId: string;
  operationId: string;
  phase: TaskOperationJournalRecord["phase"];
}

export async function findTaskCreationSource(
  stateRoot: string,
  input: {
    target: Pick<TaskTargetIdentity, "kind" | "key">;
    listId: string;
    taskId: string;
  },
): Promise<TaskCreationSource | undefined> {
  let directory: string;
  try {
    const requested = join(stateRoot, "task-operations");
    const metadata = await lstat(requested);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o777) !== 0o700
    )
      throw new Error(
        "Task operation storage must be an ordinary private directory.",
      );
    directory = await realpath(requested);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  const owner = join(
    directory,
    `owner-${sha256(`list:${input.listId}`)}.journal`,
  );
  return withOwners(directory, [owner], async () => {
    const found: TaskCreationSource[] = [];
    for (const name of (await readdir(directory))
      .filter((item) => /^[a-f0-9]{64}\.json$/u.test(item))
      .sort()) {
      const path = join(directory, name);
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error("Task journal must be an ordinary file.");
      const record = parseJournal(JSON.parse(await readFile(path, "utf8")));
      const { plan } = record;
      if (
        plan.operation.name !== "create" ||
        record.taskId !== input.taskId ||
        plan.listId !== input.listId ||
        plan.target.kind !== input.target.kind ||
        plan.target.key !== input.target.key ||
        plan.sourceOccurrenceId === undefined
      )
        continue;
      found.push({
        sourceOccurrenceId: plan.sourceOccurrenceId,
        operationId: plan.operationId,
        phase: record.phase,
      });
    }
    if (found.length > 1)
      throw new Error(
        "Conflicting exact task creation identities require reconciliation.",
      );
    return found[0];
  });
}

// Atomic journal publication lets a recovery capture observe source evidence without re-entering
// the list owner already held by an exact-plan executor.
export async function readTaskCreationHistory(
  stateRoot: string,
  input: { target: Pick<TaskTargetIdentity, "kind" | "key">; listId: string },
): Promise<TaskOperationJournalRecord[]> {
  return (await readTaskOperationHistory(stateRoot, input)).filter(
    (record) => record.plan.operation.name === "create",
  );
}

// Called while the exact-plan executor already holds the list owner. Older completion journals
// predate effect-key reservations; a changed operation ID cannot evade their uncertain send.
export async function hasOtherSentTaskCompletion(
  stateRoot: string,
  plan: TaskOperationJournalRecord["plan"],
): Promise<boolean> {
  if (plan.operation.name !== "complete") return false;
  const taskId = plan.operation.taskId;
  return (
    await readTaskOperationHistory(stateRoot, {
      target: plan.target,
      listId: plan.listId,
    })
  ).some(
    (record) =>
      record.plan.operationId !== plan.operationId &&
      record.plan.operation.name === "complete" &&
      record.plan.operation.taskId === taskId &&
      ["uncertain", "verified", "applied"].includes(record.phase),
  );
}

async function readTaskOperationHistory(
  stateRoot: string,
  input: { target: Pick<TaskTargetIdentity, "kind" | "key">; listId: string },
): Promise<TaskOperationJournalRecord[]> {
  const directory = join(stateRoot, "task-operations");
  const info = await lstat(directory).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (info === undefined) return [];
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700
  )
    throw new Error("Unsafe task creation history storage.");
  const records: TaskOperationJournalRecord[] = [];
  for (const name of (await readdir(directory))
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .sort()) {
    const path = join(directory, name);
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size > 1024 * 1024
    )
      throw new Error("Unsafe task creation history file.");
    const record = parseJournal(JSON.parse(await readFile(path, "utf8")));
    if (name !== `${sha256(record.plan.operationId)}.json`)
      throw new Error("Task creation history identity mismatch.");
    if (
      record.plan.target.kind === input.target.kind &&
      record.plan.target.key === input.target.key &&
      record.plan.listId === input.listId
    )
      records.push(record);
  }
  return records;
}
