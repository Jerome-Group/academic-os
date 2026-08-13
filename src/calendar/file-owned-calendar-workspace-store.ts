import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OperationalError } from "../operational-error.js";
import type {
  OwnedCalendarWorkspace,
  OwnedCalendarWorkspaceReader,
  OwnedCalendarWorkspaceStore,
} from "./types.js";
import { OWNED_CALENDAR_ROLES } from "./types.js";

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

export function createFileOwnedCalendarWorkspaceReader(
  stateRoot: string,
): OwnedCalendarWorkspaceReader {
  return {
    read: async () => {
      let value: unknown;
      try {
        value = JSON.parse(
          await readFile(
            join(stateRoot, "calendar", "owned-calendars.json"),
            "utf8",
          ),
        );
      } catch {
        throw new OperationalError(
          "invalid-config",
          "Calendar setup must complete before Refresh.",
        );
      }
      if (!isOwnedCalendarWorkspace(value)) {
        throw new OperationalError(
          "invalid-config",
          "The private Owned-calendar workspace is invalid.",
        );
      }
      return value;
    },
  };
}

function isOwnedCalendarWorkspace(
  value: unknown,
): value is OwnedCalendarWorkspace {
  if (!isObject(value) || !isObject(value.ownedCalendarIds)) return false;
  const ids = value.ownedCalendarIds;
  return (
    value.schemaVersion === 1 &&
    value.defaultTimezone === "Asia/Singapore" &&
    typeof value.managementHorizon === "string" &&
    OWNED_CALENDAR_ROLES.every(
      (role) => typeof ids[role] === "string" && ids[role] !== "",
    )
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
