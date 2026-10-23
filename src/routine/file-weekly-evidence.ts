import { randomUUID } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
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
          info.uid !== process.getuid?.() ||
          info.isSymbolicLink() ||
          (info.mode & 0o077) !== 0
        )
          throw new OperationalError(
            "unsafe-state-root",
            "Weekly migration evidence requires private ordinary directories.",
          );
      }
      const file = await open(
        join(root, `issue-${input.number}-${randomUUID()}.json`),
        "wx",
        0o600,
      );
      try {
        await file.writeFile(
          `${JSON.stringify({ schemaVersion: 2, observedAt: new Date().toISOString(), ...input }, null, 2)}\n`,
        );
        await file.sync();
      } finally {
        await file.close();
      }
      const directory = await open(root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    },
  };
}
