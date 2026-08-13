import { createHash } from "node:crypto";

import { OperationalError } from "../operational-error.js";
import {
  addTravelBuffer,
  collectCalendarAvailability,
  findCalendarOverlaps,
} from "./calendar-conflicts.js";
import { parseCalendarProposalInput } from "./calendar-proposal-input.js";
import type {
  CalendarListEntry,
  CalendarProposal,
  CalendarProposalCandidate,
  CalendarProposalReader,
  CalendarProposalStore,
  CalendarProposeReport,
  OwnedCalendarMirror,
  OwnedCalendarMirrorStore,
  OwnedCalendarWorkspaceReader,
} from "./types.js";
import { OWNED_CALENDAR_ROLES } from "./types.js";

export async function createCalendarProposal(input: {
  value: unknown;
  reader: CalendarProposalReader;
  workspaceReader: OwnedCalendarWorkspaceReader;
  mirrorStore: OwnedCalendarMirrorStore;
  proposalStore: CalendarProposalStore;
}): Promise<CalendarProposeReport> {
  const workspace = await input.workspaceReader.read();
  const parsed = parseCalendarProposalInput(
    input.value,
    workspace.defaultTimezone,
  );
  const mirrors = await readCurrentMirrors(input.mirrorStore, workspace);
  const calendars = validateCalendars(await input.reader.listCalendars());
  const targetCalendarId = workspace.ownedCalendarIds[parsed.item.calendarRole];
  const targetCalendar = calendars.find(({ id }) => id === targetCalendarId);
  if (targetCalendar === undefined) {
    throw new OperationalError(
      "invalid-target",
      `The ${parsed.item.calendarRole} calendar is not visible in the current Calendar list.`,
    );
  }
  if (typeof targetCalendar.etag !== "string" || targetCalendar.etag === "") {
    throw new OperationalError(
      "operational-failure",
      `Calendar Propose received no live version for ${parsed.item.calendarRole}.`,
    );
  }

  const checkedInterval = addTravelBuffer(
    parsed.item.occupiedInterval,
    parsed.item.travelBuffer,
  );
  const availability =
    checkedInterval === null
      ? { items: [], checkedCalendarCount: 0 }
      : await collectCalendarAvailability({
          reader: input.reader,
          calendars,
          mirrors,
          ownedCalendarIds: workspace.ownedCalendarIds,
          interval: checkedInterval,
        });
  const overlaps = findCalendarOverlaps({
    availability: availability.items,
    interval: checkedInterval,
    proposedKind: parsed.item.kind,
  });
  const conflicts = overlaps.filter(({ severity }) => severity === "block");
  const warnings = overlaps.filter(({ severity }) => severity === "warning");
  const intentDigest = calendarStateDigest({
    operation: "create",
    source: parsed.source,
    itemKind: parsed.item.kind,
    target: {
      calendarRole: parsed.item.calendarRole,
      calendarId: targetCalendarId,
    },
    intendedEvent: parsed.item.intendedEvent,
  });
  const proposal: CalendarProposalCandidate = {
    id: `proposal-${intentDigest.slice(0, 24)}`,
    ...(conflicts.length === 0 ? { status: "ready" as const } : {}),
    operation: "create",
    source: parsed.source,
    itemKind: parsed.item.kind,
    target: {
      calendarRole: parsed.item.calendarRole,
      calendarId: targetCalendarId,
    },
    intendedEvent: parsed.item.intendedEvent,
    inheritedDefaults: {
      calendarColorId: targetCalendar.colorId ?? null,
      reminders: validateReminders(targetCalendar.defaultReminders),
    },
    targetCalendarVersion: {
      calendarId: targetCalendarId,
      etag: targetCalendar.etag,
    },
    idempotencyKey: `create-${intentDigest}`,
    liveVersions: mirrors.map((mirror) => ({
      kind: "owned-mirror",
      calendarRole: mirror.role,
      calendarId: mirror.calendarId,
      syncToken: mirror.syncToken as string,
      lastSuccessfulRefresh: mirror.lastSuccessfulRefresh as string,
    })),
    relevantAvailabilityVersion: {
      digest: calendarStateDigest(
        availability.items.map(({ calendarId, event }) => ({
          calendarId,
          event,
        })),
      ),
      interval: checkedInterval,
      checkedCalendarCount: availability.checkedCalendarCount,
    },
    conflictSummary: {
      blockers: conflicts.length,
      warnings: warnings.length,
    },
  };
  const ready = conflicts.length === 0;
  if (ready) {
    const readyProposal: CalendarProposal = { ...proposal, status: "ready" };
    await input.proposalStore.writeCurrent(readyProposal);
  }
  return {
    schemaVersion: 1,
    command: "calendar propose",
    outcome: ready ? "ready" : "blocked",
    proposal,
    conflicts,
    warnings,
    workspace: ready ? "written" : "not-written",
  };
}

async function readCurrentMirrors(
  mirrorStore: OwnedCalendarMirrorStore,
  workspace: Awaited<ReturnType<OwnedCalendarWorkspaceReader["read"]>>,
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

function validateCalendars(value: CalendarListEntry[]): CalendarListEntry[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (calendar) =>
        typeof calendar.id !== "string" ||
        calendar.id === "" ||
        typeof calendar.summary !== "string",
    )
  ) {
    throw new OperationalError(
      "operational-failure",
      "Calendar Propose received an invalid Calendar list.",
    );
  }
  return value;
}

function validateReminders(
  value: CalendarListEntry["defaultReminders"],
): Array<{ method: string; minutes: number }> {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (reminder) =>
        typeof reminder.method !== "string" ||
        !Number.isInteger(reminder.minutes) ||
        reminder.minutes < 0,
    )
  ) {
    throw new OperationalError(
      "operational-failure",
      "Calendar Propose received invalid inherited reminders.",
    );
  }
  return value;
}

export function calendarStateDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
