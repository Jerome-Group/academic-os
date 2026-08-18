import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ShelfMigrationJournal } from "./types.js";

// The journal is the migration's only account of what moved. It is written before the shelf is
// touched and after every book that moves, so a run that dies mid-pass leaves the exact list of
// renames that happened rather than the list that was planned.
export function createFileShelfMigrationJournal(
  stateRoot: string,
): ShelfMigrationJournal {
  const target = join(stateRoot, "journals", "textbooks", "migration.jsonl");
  return {
    record: async (event) => {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await appendFile(
        target,
        `${JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), ...event })}\n`,
        { mode: 0o600 },
      );
    },
  };
}
