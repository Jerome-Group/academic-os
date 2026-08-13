import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { OwnedCalendarMirrorStore } from "./types.js";

export function createFileOwnedCalendarMirrorStore(
  stateRoot: string,
): OwnedCalendarMirrorStore {
  return {
    write: async (mirror) => {
      const mirrorsRoot = join(stateRoot, "calendar", "mirrors");
      await mkdir(mirrorsRoot, { recursive: true, mode: 0o700 });
      const roleName = mirror.role.toLowerCase();
      const target = join(mirrorsRoot, `${roleName}.json`);
      const temporary = join(mirrorsRoot, `.${roleName}-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(mirror, null, 2)}\n`, {
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
