import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { OperationalError } from "../operational-error.js";
import {
  isJsonObject,
  replacePrivateCalendarJson,
} from "./private-calendar-json.js";
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
      const target = join(calendarRoot, "owned-calendars.json");
      await replacePrivateCalendarJson(target, "owned-calendars", workspace);
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
  if (!isJsonObject(value) || !isJsonObject(value.ownedCalendarIds)) {
    return false;
  }
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
