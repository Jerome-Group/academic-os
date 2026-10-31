import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { sha256 } from "../checksum.js";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import {
  parseTaskRestorePlan,
  taskRestorePlanDigest,
} from "./task-restore-plan.js";
import type {
  TaskRestoreJournal,
  TaskRestoreJournalRecord,
} from "./task-restore-types.js";

export class TaskRestoreOwnershipError extends Error {
  readonly code = "owner-busy";
}
export class TaskRestoreClaimError extends Error {
  readonly code = "restore-identity-reserved";
}

export function createFileTaskRestoreJournal(input: {
  stateRoot: string;
  excludedRoots: readonly string[];
}): TaskRestoreJournal {
  return {
    async withOwner(scope, run) {
      const directory = await locate(input);
      const sourceKey = sha256(
        JSON.stringify([
          scope.target.kind,
          scope.target.key,
          scope.sourceOccurrenceId,
        ]),
      );
      const identityKey = sha256(
        JSON.stringify([
          scope.target.kind,
          scope.target.key,
          scope.listId,
          scope.originalTaskId,
        ]),
      );
      const claims = [
        join(directory, `restore-source-${sourceKey}.json`),
        join(directory, `restore-identity-${identityKey}.json`),
      ];
      const ownerKeys = [
        `list:${scope.listId}`,
        `restore-operation:${scope.operationId}`,
        `source:${sourceKey}`,
        `restore-identity:${identityKey}`,
      ].sort();
      for (const key of ownerKeys) {
        try {
          await lstat(join(directory, `${sha256(key)}.lock`));
          throw new TaskRestoreOwnershipError(
            "Legacy Task ownership evidence requires reconciliation.",
          );
        } catch (error) {
          if (!hasCode(error, "ENOENT")) throw error;
        }
      }
      return withOwners(
        directory,
        ownerKeys.map((key) => join(directory, `owner-${sha256(key)}.journal`)),
        async () => {
          for (const path of claims) await checkClaim(path, scope.operationId);
          const path = join(
            directory,
            `restore-${sha256(scope.operationId)}.json`,
          );
          const read = async (): Promise<
            TaskRestoreJournalRecord | undefined
          > => {
            const bytes = await readPrivate(path);
            if (bytes === undefined) return undefined;
            const record = parseRecord(JSON.parse(bytes));
            if (record.plan.operationId !== scope.operationId)
              throw new Error("Restore journal operation identity mismatch.");
            return record;
          };
          let active = true;
          let pending: Promise<unknown> = Promise.resolve();
          const admitted: Promise<unknown>[] = [];
          const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
            if (!active)
              return Promise.reject(
                new Error("Task restore journal session expired."),
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
                    const checked = parseRecord(captured);
                    const plan = checked.plan;
                    if (
                      plan.operationId !== scope.operationId ||
                      plan.listId !== scope.listId ||
                      plan.originalTaskId !== scope.originalTaskId ||
                      plan.sourceOccurrenceId !== scope.sourceOccurrenceId ||
                      plan.target.kind !== scope.target.kind ||
                      plan.target.key !== scope.target.key
                    )
                      throw new Error("Restore journal scope mismatch.");
                    assertTransition(await read(), checked);
                    for (const claim of claims) {
                      await checkClaim(
                        claim,
                        scope.operationId,
                        checked.planDigest,
                      );
                      await replaceSynced(
                        directory,
                        claim,
                        JSON.stringify({
                          operationId: scope.operationId,
                          planDigest: checked.planDigest,
                        }),
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
          const drained = await Promise.allSettled(admitted);
          if (!outcome.ok) throw outcome.error;
          const failed = drained.find((item) => item.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          return outcome.value;
        },
      );
    },
  };
}

async function locate(input: {
  stateRoot: string;
  excludedRoots: readonly string[];
}): Promise<string> {
  if (!isAbsolute(input.stateRoot) || input.excludedRoots.length === 0)
    throw new Error(
      "Restore storage requires an absolute private root and excluded repository/Drive roots.",
    );
  const metadata = await lstat(input.stateRoot);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error(
      "Restore state root must be an ordinary private directory owned by the current user.",
    );
  const root = await realpath(input.stateRoot);
  for (const excluded of input.excludedRoots) {
    if (!isAbsolute(excluded))
      throw new Error("Excluded restore roots must be absolute.");
    const boundary = await realpath(excluded);
    const child = relative(boundary, root);
    const ancestor = relative(root, boundary);
    const inside = (path: string): boolean =>
      path === "" ||
      (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
    if (inside(child) || inside(ancestor))
      throw new Error(
        "Restore storage must be outside excluded repository and academic roots.",
      );
  }
  const requested = join(root, "task-operations");
  await mkdir(requested, { mode: 0o700 }).catch((error: unknown) => {
    if (!hasCode(error, "EEXIST")) throw error;
  });
  const directory = await lstat(requested);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o777) !== 0o700 ||
    (await realpath(requested)) !== requested
  )
    throw new Error("Restore journals require canonical private storage.");
  return requested;
}

async function withOwners<T>(
  root: string,
  paths: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  const [path, ...rest] = paths;
  if (path === undefined) return run();
  const owned = await withJournalMutationOwner(
    { stateRoot: root, journalPath: path },
    () => withOwners(root, rest, run),
  );
  if (owned.kind === "refused") {
    if (owned.reason === "busy")
      throw new TaskRestoreOwnershipError(owned.evidence);
    throw new Error(owned.evidence);
  }
  return owned.value;
}

async function readPrivate(path: string): Promise<string | undefined> {
  let file: FileHandle;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o600 ||
      info.size > 1024 * 1024
    )
      throw new Error("Unsafe or oversized Task restore journal.");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await file.readFile(),
    );
  } finally {
    await file.close();
  }
}

async function checkClaim(
  path: string,
  operationId: string,
  digest?: string,
): Promise<void> {
  const bytes = await readPrivate(path);
  if (bytes === undefined) return;
  const value: unknown = JSON.parse(bytes);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "operationId,planDigest" ||
    typeof Reflect.get(value, "operationId") !== "string" ||
    !/^[a-f0-9]{64}$/u.test(String(Reflect.get(value, "planDigest")))
  )
    throw new Error("Invalid Task restore identity reservation.");
  if (
    Reflect.get(value, "operationId") !== operationId ||
    (digest !== undefined && Reflect.get(value, "planDigest") !== digest)
  )
    throw new TaskRestoreClaimError(
      "This Task identity/source already belongs to an immutable restore plan.",
    );
}

function parseRecord(value: unknown): TaskRestoreJournalRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "phase,plan,planDigest,schemaVersion,taskId"
  )
    throw new Error("Invalid Task restore journal fields.");
  const plan = parseTaskRestorePlan(Reflect.get(value, "plan"));
  const phase = Reflect.get(
    value,
    "phase",
  ) as TaskRestoreJournalRecord["phase"];
  const taskId = Reflect.get(value, "taskId") as unknown;
  const planDigest = taskRestorePlanDigest(plan);
  if (
    Reflect.get(value, "schemaVersion") !== 1 ||
    Reflect.get(value, "planDigest") !== planDigest ||
    !["prepared", "sending", "verified", "applied", "rejected"].includes(
      phase,
    ) ||
    !(
      taskId === null ||
      (typeof taskId === "string" &&
        taskId.trim() !== "" &&
        !taskId.includes("\0"))
    ) ||
    ((phase === "verified" || phase === "applied") && taskId === null) ||
    (phase === "prepared" && taskId !== null)
  )
    throw new Error("Invalid Task restore journal evidence.");
  return { schemaVersion: 1, plan, planDigest, phase, taskId };
}

function assertTransition(
  previous: TaskRestoreJournalRecord | undefined,
  next: TaskRestoreJournalRecord,
): void {
  if (previous === undefined) {
    if (next.phase !== "prepared")
      throw new Error("Restore intent must persist before sending.");
    return;
  }
  if (
    previous.planDigest !== next.planDigest ||
    (previous.taskId !== null && previous.taskId !== next.taskId)
  )
    throw new Error("Restore journal identity cannot change.");
  const allowed: Record<
    TaskRestoreJournalRecord["phase"],
    readonly TaskRestoreJournalRecord["phase"][]
  > = {
    prepared: ["prepared", "sending"],
    sending: ["sending", "verified", "rejected"],
    verified: ["verified", "applied"],
    applied: ["applied"],
    rejected: ["rejected"],
  };
  if (!allowed[previous.phase].includes(next.phase))
    throw new Error("Restore journal cannot rewind execution.");
}

async function replaceSynced(
  directory: string,
  path: string,
  contents: string,
): Promise<void> {
  const temporary = join(directory, `.restore-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const parent = await open(directory, constants.O_RDONLY);
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    if ((await readPrivate(path)) !== contents)
      throw new Error("Restore journal publication failed verification.");
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
  }
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
