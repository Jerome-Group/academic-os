import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { sha256 } from "../checksum.js";
import { ensureMaterialized } from "../mounted/ensure-materialized.js";
import { OperationalError } from "../operational-error.js";

export function recoverableRegisterFile(input: {
  targetRoot: string;
  registerPath: string;
  stateRoot?: string;
}): {
  read(): Promise<string | undefined>;
  replace(original: string | undefined, contents: string): Promise<void>;
} {
  const path = join(input.targetRoot, input.registerPath);
  const backupRoot = join(
    input.stateRoot ?? join(homedir(), ".local/state/academic-os"),
    "task-register-backups",
  );
  const read = async (): Promise<string | undefined> => {
    if (!(await assertOrdinaryPath(input.targetRoot, input.registerPath)))
      return undefined;
    try {
      await ensureMaterialized(path);
      const bytes = await readFile(path);
      try {
        return new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        throw failure(
          "The Task register is not valid UTF-8; original bytes retained.",
        );
      }
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    }
  };
  return {
    read,
    replace: async (original, contents) => {
      await mkdir(backupRoot, { recursive: true, mode: 0o700 });
      const root = await realpath(input.targetRoot);
      const recovery = await realpath(backupRoot);
      if (isInside(root, recovery))
        throw failure(
          "Recovery storage must be outside the Task-register target.",
        );
      const lockPath = join(
        recovery,
        `${sha256(resolve(root, input.registerPath))}.lock`,
      );
      const lock = await open(lockPath, "wx", 0o600).catch(() => {
        throw failure(
          "Another Task-register write is active or interrupted; inspect its recovery lock before retrying.",
        );
      });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await assertUnchanged(read, original);
        if (original === contents) return;
        const id = randomUUID();
        const journal = join(recovery, `${id}.json`);
        const backup =
          original === undefined ? undefined : join(recovery, `${id}.original`);
        if (backup !== undefined && original !== undefined) {
          await writeSyncedExclusively(backup, original);
          if (!(await readFile(backup)).equals(Buffer.from(original, "utf8")))
            throw failure("Task-register backup verification failed.");
        }
        const evidence = {
          path: resolve(root, input.registerPath),
          originalSha256: original === undefined ? null : sha256(original),
          intendedSha256: sha256(contents),
          backup: backup ?? null,
          createdAt: new Date().toISOString(),
        };
        await writeFile(
          journal,
          `${JSON.stringify({ ...evidence, status: "prepared" }, null, 2)}\n`,
          { flag: "wx", mode: 0o600 },
        );
        if (original === undefined) {
          await assertUnchanged(read, original);
          await writeSyncedExclusively(path, contents);
        } else {
          await writeSyncedExclusively(temporary, contents);
          await assertUnchanged(read, original);
          await rename(temporary, path);
        }
        if ((await read()) !== contents)
          throw failure(
            "Task-register publication did not verify; retain its recovery journal.",
          );
        await writeFile(
          join(recovery, `${id}.verified.json`),
          `${JSON.stringify({ ...evidence, status: "verified" }, null, 2)}\n`,
          { flag: "wx", mode: 0o600 },
        );
      } finally {
        await unlink(temporary).catch(() => undefined);
        await lock.close();
        await unlink(lockPath);
      }
    },
  };
}

async function writeSyncedExclusively(
  path: string,
  contents: string,
): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

async function assertOrdinaryPath(
  root: string,
  path: string,
): Promise<boolean> {
  let current = await realpath(root);
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current).catch((error: unknown) => {
      if (index === parts.length - 1 && hasCode(error, "ENOENT"))
        return undefined;
      throw error;
    });
    if (info === undefined) return false;
    if (
      info.isSymbolicLink() ||
      (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
    ) {
      throw failure(
        "Task-register paths must contain only ordinary directories and a regular file.",
      );
    }
  }
  return true;
}

async function assertUnchanged(
  read: () => Promise<string | undefined>,
  original: string | undefined,
): Promise<void> {
  if ((await read()) !== original)
    throw failure(
      "The Task register changed after it was read; refresh before retrying.",
    );
}

function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    child === "" ||
    (child !== ".." && !child.startsWith("../") && !isAbsolute(child))
  );
}

function failure(message: string): OperationalError {
  return new OperationalError("operational-failure", message);
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}
