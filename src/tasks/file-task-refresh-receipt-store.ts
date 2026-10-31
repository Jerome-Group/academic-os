import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { sha256 } from "../checksum.js";
import { resolveStateRoot } from "../config/resolve-state-root.js";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import { OperationalError } from "../operational-error.js";
import {
  parseTaskRefreshReceipt,
  taskRefreshReceipt,
} from "./task-refresh-receipt.js";
import type {
  TaskRefreshReceipt,
  TaskRefreshReceiptStore,
  TaskTargetIdentity,
} from "./types.js";

export function createFileTaskRefreshReceiptStore(input: {
  stateRoot: string;
  driveMount: string;
  target: TaskTargetIdentity;
}): TaskRefreshReceiptStore {
  const key = sha256(JSON.stringify([input.target.kind, input.target.key]));
  const directoryFor = async (create: boolean): Promise<string | undefined> => {
    const stateRoot = await resolveStateRoot(input);
    const directory = join(stateRoot, "task-refresh-receipts");
    if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
    const resolved = await realpath(directory).catch((error: unknown) => {
      if (
        !create &&
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return undefined;
      throw error;
    });
    if (resolved === undefined) return undefined;
    if (resolved !== directory)
      throw failure(
        "Task-refresh receipt storage must be an ordinary private directory.",
      );
    return directory;
  };
  const read = async (): Promise<TaskRefreshReceipt | undefined> => {
    const directory = await directoryFor(false);
    if (directory === undefined) return undefined;
    const receipt = await readReceipt(join(directory, `${key}.json`));
    if (receipt !== undefined && !sameTarget(receipt.target, input.target))
      throw failure(
        "Stored Task-refresh receipt has a different target identity.",
      );
    return receipt;
  };
  return {
    read,
    record: async (attempt) => {
      if (!sameTarget(attempt.target, input.target))
        throw failure("Task-refresh receipt target does not match its store.");
      const directory = await directoryFor(true);
      if (directory === undefined)
        throw failure("Task-refresh receipt storage is unavailable.");
      const destination = join(directory, `${key}.json`);
      const owned = await withJournalMutationOwner(
        { stateRoot: dirname(directory), journalPath: destination },
        async (canonicalPath) => {
          const temporary = join(directory, `.${key}-${randomUUID()}.tmp`);
          try {
            const previous = await readReceipt(canonicalPath);
            if (
              previous !== undefined &&
              !sameTarget(previous.target, input.target)
            )
              throw failure(
                "Stored Task-refresh receipt has a different target identity.",
              );
            const receipt = taskRefreshReceipt(attempt, previous);
            const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
            const file = await open(temporary, "wx", 0o600);
            try {
              await file.writeFile(bytes);
              await file.sync();
            } finally {
              await file.close();
            }
            await rename(temporary, canonicalPath);
            const parent = await open(directory, constants.O_RDONLY);
            try {
              await parent.sync();
            } finally {
              await parent.close();
            }
            if ((await readFile(canonicalPath, "utf8")) !== bytes)
              throw failure(
                "Task-refresh receipt publication failed readback.",
              );
            return receipt;
          } finally {
            await rm(temporary, { force: true });
          }
        },
      );
      if (owned.kind === "refused") throw failure(owned.evidence);
      return owned.value;
    },
  };
}

async function readReceipt(
  path: string,
): Promise<TaskRefreshReceipt | undefined> {
  const info = await lstat(path).catch((error: unknown) => {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return undefined;
    throw error;
  });
  if (info === undefined) return undefined;
  if (!info.isFile() || info.isSymbolicLink())
    throw failure("Task-refresh receipt must be an ordinary private file.");
  return parseTaskRefreshReceipt(await readFile(path, "utf8"));
}

function sameTarget(
  left: TaskTargetIdentity,
  right: TaskTargetIdentity,
): boolean {
  return left.kind === right.kind && left.key === right.key;
}

function failure(message: string): OperationalError {
  return new OperationalError("operational-failure", message);
}
