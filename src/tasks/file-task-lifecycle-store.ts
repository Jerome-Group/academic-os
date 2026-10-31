import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import {
  emptyTaskLifecycleState,
  parseTaskLifecycleState,
  recordTaskLifecycle,
  type TaskLifecycleEntry,
  type TaskLifecycleState,
} from "./task-lifecycle.js";

export interface TaskLifecycleMutationSession {
  read(): Promise<TaskLifecycleState>;
  record(entry: TaskLifecycleEntry): Promise<TaskLifecycleState>;
}
export interface TaskLifecycleStore {
  read(): Promise<TaskLifecycleState>;
  withMutation<T>(
    run: (session: TaskLifecycleMutationSession) => Promise<T>,
  ): Promise<T>;
}

// The caller holds this session around executor ownership and all provider effects.
export function createFileTaskLifecycleStore(input: {
  stateRoot: string;
  excludedRoots: readonly string[];
}): TaskLifecycleStore {
  const locate = async (): Promise<{ root: string; path: string }> => {
    if (!isAbsolute(input.stateRoot) || input.excludedRoots.length === 0)
      throw new Error(
        "Lifecycle storage needs an absolute private root and explicit excluded Drive/repository roots.",
      );
    const info = await lstat(input.stateRoot);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700
    )
      throw new Error(
        "Lifecycle storage must be a private ordinary directory owned by the current user.",
      );
    const root = await realpath(input.stateRoot);
    for (const excluded of input.excludedRoots) {
      if (!isAbsolute(excluded))
        throw new Error("Excluded lifecycle roots must be absolute.");
      const boundary = await realpath(excluded);
      const child = relative(boundary, root);
      if (
        child === "" ||
        (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
      )
        throw new Error(
          "Lifecycle storage must be outside Drive, academic targets and the public repository.",
        );
    }
    return { root, path: join(root, "task-lifecycle.json") };
  };
  return {
    async read() {
      const { path } = await locate();
      return (await readState(path)).state;
    },
    async withMutation<T>(
      run: (session: TaskLifecycleMutationSession) => Promise<T>,
    ): Promise<T> {
      const { root, path } = await locate();
      const owned = await withJournalMutationOwner(
        { stateRoot: root, journalPath: path },
        async (canonicalPath) => {
          let active = true;
          let pending: Promise<unknown> = Promise.resolve();
          const admitted: Promise<unknown>[] = [];
          const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
            if (!active)
              return Promise.reject(
                new Error("Task lifecycle mutation session has expired."),
              );
            const result = pending.then(operation);
            pending = result;
            admitted.push(result);
            void result.catch(() => undefined);
            return result;
          };
          const session: TaskLifecycleMutationSession = {
            read: () =>
              enqueue(async () => (await readState(canonicalPath)).state),
            record: (entry) => {
              const captured = structuredClone(entry);
              return enqueue(async () => {
                const previous = await readState(canonicalPath);
                const next = recordTaskLifecycle(previous.state, captured);
                if (next.revision !== previous.state.revision)
                  await replaceState(canonicalPath, root, previous.bytes, next);
                return next;
              });
            },
          };
          let outcome: { ok: true; value: T } | { ok: false; error: unknown };
          try {
            outcome = { ok: true, value: await run(session) };
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
      if (owned.kind === "refused") throw new Error(owned.evidence);
      return owned.value;
    },
  };
}

async function readState(
  path: string,
): Promise<{ bytes: string | undefined; state: TaskLifecycleState }> {
  let file: FileHandle;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ENOENT"))
      return { bytes: undefined, state: emptyTaskLifecycleState() };
    throw error;
  }
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o600 ||
      info.size > 32 * 1024 * 1024
    )
      throw new Error("Unsafe or oversized Task lifecycle state.");
    const bytes = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.readFile(),
    );
    return { bytes, state: parseTaskLifecycleState(JSON.parse(bytes)) };
  } finally {
    await file.close();
  }
}

async function replaceState(
  path: string,
  root: string,
  previous: string | undefined,
  state: TaskLifecycleState,
): Promise<void> {
  const bytes = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > 32 * 1024 * 1024)
    throw new Error("Task lifecycle state exceeds its private storage limit.");
  const temporary = join(root, `.task-lifecycle-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    if ((await readState(path)).bytes !== previous)
      throw new Error(
        "Task lifecycle state changed outside its mutation owner.",
      );
    await rename(temporary, path);
    const parent = await open(root, constants.O_RDONLY);
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    if ((await readState(path)).bytes !== bytes)
      throw new Error("Task lifecycle state persistence did not verify.");
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
  }
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
