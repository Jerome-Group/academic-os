import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  CalendarPromotionJournal,
  CalendarPromotionRecord,
} from "./types.js";

export function createFileCalendarPromotionJournal(
  stateRoot: string,
): CalendarPromotionJournal {
  const target = join(stateRoot, "calendar", "promotions.jsonl");
  const lock = `${target}.lock`;
  return {
    find: async (proposalId) =>
      (await readRecords(target)).find(
        (record) => record.proposalId === proposalId,
      ),
    appendOnce: async (record) => {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const handle = await acquireLock(lock);
      try {
        if (
          (await readRecords(target)).some(
            ({ proposalId }) => proposalId === record.proposalId,
          )
        ) {
          return false;
        }
        await appendFile(target, `${JSON.stringify(record)}\n`, {
          mode: 0o600,
        });
        return true;
      } finally {
        await handle.close();
        await rm(lock, { force: true });
      }
    },
  };
}

async function acquireLock(lock: string): Promise<FileHandle> {
  try {
    const handle = await open(lock, "wx", 0o600);
    await writeFile(handle, `${process.pid}\n`);
    return handle;
  } catch (error) {
    if (!isExistingFile(error)) throw error;
    const owner = Number.parseInt(await readFile(lock, "utf8"), 10);
    if (Number.isInteger(owner) && processIsAlive(owner)) {
      throw new Error("Another Calendar Promotion is in progress.");
    }
    const stale = `${lock}.stale-${randomUUID()}`;
    try {
      await rename(lock, stale);
    } catch (renameError) {
      if (
        typeof renameError === "object" &&
        renameError !== null &&
        "code" in renameError &&
        renameError.code === "ENOENT"
      ) {
        return await acquireLock(lock);
      }
      throw renameError;
    }
    try {
      return await acquireLock(lock);
    } finally {
      await rm(stale, { force: true });
    }
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isExistingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function readRecords(target: string): Promise<CalendarPromotionRecord[]> {
  try {
    return (await readFile(target, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CalendarPromotionRecord);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}
