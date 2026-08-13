import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { OperationalError } from "../operational-error.js";
import {
  isJsonObject,
  isMissingFile,
  replacePrivateCalendarJson,
} from "./private-calendar-json.js";
import type {
  OwnedCalendarMirror,
  OwnedCalendarMirrorStore,
  OwnedCalendarRole,
} from "./types.js";

export function createFileOwnedCalendarMirrorStore(
  stateRoot: string,
): OwnedCalendarMirrorStore {
  return {
    read: async (role) => await readMirror(stateRoot, role),
    write: async (mirror) => {
      const mirrorsRoot = join(stateRoot, "calendar", "mirrors");
      const roleName = mirror.role.toLowerCase();
      const target = join(mirrorsRoot, `${roleName}.json`);
      await replacePrivateCalendarJson(target, roleName, mirror);
    },
  };
}

async function readMirror(
  stateRoot: string,
  role: OwnedCalendarRole,
): Promise<OwnedCalendarMirror | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(
        join(stateRoot, "calendar", "mirrors", `${role.toLowerCase()}.json`),
        "utf8",
      ),
    );
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new OperationalError(
      "operational-failure",
      `The private ${role} calendar mirror is invalid.`,
    );
  }
  if (!isJsonObject(value) || !Array.isArray(value.items)) {
    throw new OperationalError(
      "operational-failure",
      `The private ${role} calendar mirror is invalid.`,
    );
  }
  const lastSuccessfulRefresh =
    typeof value.lastSuccessfulRefresh === "string"
      ? value.lastSuccessfulRefresh
      : typeof value.refreshedAt === "string"
        ? value.refreshedAt
        : null;
  return {
    ...(value as unknown as OwnedCalendarMirror),
    lastSuccessfulRefresh,
    freshness: value.freshness === "stale" ? "stale" : "fresh",
    tombstones: Array.isArray(value.tombstones) ? value.tombstones : [],
  };
}
