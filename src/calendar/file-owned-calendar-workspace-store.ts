import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { OwnedCalendarWorkspaceStore } from "./types.js";

export function createFileOwnedCalendarWorkspaceStore(
  stateRoot: string,
): OwnedCalendarWorkspaceStore {
  return {
    write: async (workspace) => {
      const calendarRoot = join(stateRoot, "calendar");
      await mkdir(calendarRoot, { recursive: true, mode: 0o700 });
      const target = join(calendarRoot, "owned-calendars.json");
      const temporary = join(
        calendarRoot,
        `.owned-calendars-${randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporary, `${JSON.stringify(workspace, null, 2)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
