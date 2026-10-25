import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    read: async (role) => (await readMirror(stateRoot, role))?.mirror,
    write: async (mirror) => {
      const mirrorsRoot = join(stateRoot, "calendar", "mirrors");
      const roleName = mirror.role.toLowerCase();
      const target = join(mirrorsRoot, `${roleName}.json`);
      const previous = await readMirror(stateRoot, mirror.role);
      if (
        previous !== undefined &&
        (previous.mirror.calendarId !== mirror.calendarId ||
          previous.mirror.managementHorizon !== mirror.managementHorizon ||
          JSON.stringify(previous.mirror.syncQuery) !==
            JSON.stringify(mirror.syncQuery))
      ) {
        await archiveMirror(mirrorsRoot, roleName, previous.bytes);
      }
      await replacePrivateCalendarJson(target, roleName, mirror);
    },
  };
}

async function readMirror(
  stateRoot: string,
  role: OwnedCalendarRole,
): Promise<{ bytes: Buffer; mirror: OwnedCalendarMirror } | undefined> {
  let value: unknown;
  let bytes: Buffer;
  try {
    bytes = await readFile(
      join(stateRoot, "calendar", "mirrors", `${role.toLowerCase()}.json`),
    );
    value = JSON.parse(bytes.toString("utf8"));
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
    bytes,
    mirror: {
      ...(value as unknown as OwnedCalendarMirror),
      lastSuccessfulRefresh,
      freshness: value.freshness === "stale" ? "stale" : "fresh",
      tombstones: Array.isArray(value.tombstones) ? value.tombstones : [],
    },
  };
}

async function archiveMirror(
  mirrorsRoot: string,
  roleName: string,
  bytes: Buffer,
): Promise<void> {
  const archiveRoot = join(mirrorsRoot, "archive");
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const target = join(archiveRoot, `${roleName}-${digest}.json`);
  try {
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isJsonObject(error) || error.code !== "EEXIST") throw error;
  }
  if (!bytes.equals(await readFile(target))) {
    throw new OperationalError(
      "operational-failure",
      "The private Calendar recovery snapshot failed readback.",
    );
  }
}
