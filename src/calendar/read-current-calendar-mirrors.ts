import { OperationalError } from "../operational-error.js";
import type {
  OwnedCalendarMirror,
  OwnedCalendarMirrorStore,
  OwnedCalendarWorkspace,
  OwnedCalendarRole,
} from "./types.js";
import { OWNED_CALENDAR_ROLES } from "./types.js";

export async function readCurrentCalendarMirrors(
  mirrorStore: OwnedCalendarMirrorStore,
  workspace: OwnedCalendarWorkspace,
): Promise<OwnedCalendarMirror[]> {
  const mirrors: OwnedCalendarMirror[] = [];
  for (const role of OWNED_CALENDAR_ROLES) {
    const mirror = await mirrorStore.read(role);
    if (
      mirror === undefined ||
      mirror.freshness !== "fresh" ||
      mirror.calendarId !== workspace.ownedCalendarIds[role] ||
      typeof mirror.syncToken !== "string" ||
      typeof mirror.lastSuccessfulRefresh !== "string"
    ) {
      throw new OperationalError(
        "operational-failure",
        `Calendar Refresh must succeed for ${role} before preparing a Proposal.`,
      );
    }
    mirrors.push(mirror);
  }
  return mirrors;
}

export function currentCalendarMirror(
  mirrors: OwnedCalendarMirror[],
  role: OwnedCalendarRole,
): OwnedCalendarMirror {
  const mirror = mirrors.find((candidate) => candidate.role === role);
  if (mirror === undefined) {
    throw new OperationalError(
      "operational-failure",
      `The current ${role} calendar mirror is unavailable.`,
    );
  }
  return mirror;
}
