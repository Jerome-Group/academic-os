import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export type JournalMutationResult<T> =
  | { kind: "owned"; value: T }
  | { kind: "refused"; reason: "busy" | "unavailable"; evidence: string };

export async function withJournalMutationOwner<T>(
  input: { stateRoot: string; journalPath: string },
  run: (canonicalJournalPath: string) => Promise<T>,
): Promise<JournalMutationResult<T>> {
  let database: DatabaseSync;
  let journalPath: string;
  let stateRoot: string;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    stateRoot = await realpath(input.stateRoot);
    const journalRelative = relative(
      resolve(input.stateRoot),
      resolve(input.journalPath),
    );
    if (
      journalRelative === "" ||
      journalRelative === ".." ||
      journalRelative.startsWith(`..${sep}`) ||
      isAbsolute(journalRelative)
    )
      throw new Error("Journal is outside its private state root.");
    journalPath = join(stateRoot, journalRelative);
    await requireCanonicalAncestry(stateRoot, journalPath);
    const directory = join(stateRoot, "journal-ownership");
    await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
      if (!hasCode(error, "EEXIST")) throw error;
    });
    const parent = await lstat(directory);
    if (
      !parent.isDirectory() ||
      parent.uid !== process.getuid?.() ||
      (parent.mode & 0o777) !== 0o700 ||
      (await realpath(directory)) !== directory
    )
      throw new Error(
        "Journal ownership directory must be canonical, private and owned by the current user.",
      );
    const sidecar = join(
      directory,
      `${createHash("sha256").update(journalPath).digest("hex")}.sqlite`,
    );
    await requireSidecar(sidecar);
    // Ordinary descriptor closes can cancel SQLite's POSIX locks in this process.
    database = new DatabaseSync(sidecar, { timeout: 0 });
    try {
      await requireSidecar(sidecar);
      await chmod(sidecar, 0o600);
    } catch (error) {
      database.close();
      throw error;
    }
  } catch (error) {
    return {
      kind: "refused",
      reason: "unavailable",
      evidence: `Journal mutation ownership is unavailable: ${error instanceof Error ? error.message : "unknown failure"}`,
    };
  }
  try {
    database.exec("BEGIN IMMEDIATE");
  } catch (error) {
    database.close();
    return isBusy(error)
      ? {
          kind: "refused",
          reason: "busy",
          evidence:
            "Another invocation owns this journal; retry after it finishes.",
        }
      : {
          kind: "refused",
          reason: "unavailable",
          evidence: "Journal mutation ownership could not be acquired.",
        };
  }
  try {
    try {
      await requireCanonicalAncestry(stateRoot, journalPath);
    } catch {
      return {
        kind: "refused",
        reason: "unavailable",
        evidence: "Journal identity changed during ownership acquisition.",
      };
    }
    return { kind: "owned", value: await run(journalPath) };
  } finally {
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  }
}

async function requireCanonicalAncestry(
  stateRoot: string,
  journalPath: string,
): Promise<void> {
  let candidate = journalPath;
  while (candidate !== stateRoot) {
    try {
      const metadata = await lstat(candidate);
      if (
        metadata.isSymbolicLink() ||
        (await realpath(candidate)) !== candidate
      )
        throw new Error("Journal ancestry must be canonical.");
      if (candidate !== journalPath && !metadata.isDirectory())
        throw new Error("Journal parent is not a directory.");
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    candidate = dirname(candidate);
  }
}

async function requireSidecar(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      metadata.nlink !== 1 ||
      metadata.size !== 0 ||
      (metadata.mode & 0o7000) !== 0 ||
      ![0o600, 0o640, 0o644].includes(metadata.mode & 0o777)
    )
      throw new Error(
        "Journal ownership sidecar is not an ordinary empty private file.",
      );
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

function isBusy(error: unknown): boolean {
  return error instanceof Error && "errcode" in error && error.errcode === 5;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
