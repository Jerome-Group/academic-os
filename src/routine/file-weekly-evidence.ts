import { randomUUID } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OperationalError } from "../mounted/index.js";
import type { WeeklyIssueEvidenceStore } from "./types.js";

// Migration snapshots can contain historical private text. Their independent directory is never
// reached by the ordinary daily-report/session retention purge.
export function createFileWeeklyEvidenceStore(
  stateRoot: string,
): WeeklyIssueEvidenceStore {
  return {
    async archiveIssue(input) {
      let root = stateRoot;
      for (const name of ["weekly-evidence"]) {
        root = join(root, name);
        await mkdir(root, { mode: 0o700 }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          },
        );
        const info = await lstat(root);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          (info.mode & 0o077) !== 0
        )
          throw new OperationalError(
            "unsafe-state-root",
            "Weekly migration evidence requires private ordinary directories.",
          );
      }
      await writeFile(
        join(root, `issue-${input.number}-${randomUUID()}.json`),
        `${JSON.stringify({ schemaVersion: 1, observedAt: new Date().toISOString(), ...input }, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
    },
  };
}
