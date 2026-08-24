import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { OperationalError } from "../mounted/index.js";
import { writeFileAtomically } from "../write-file-atomically.js";
import { isCalendarDay } from "./offering-calendar-day.js";
import type { RoutineArtifactStore } from "./types.js";

const REPORT_EXTENSION = ".md";

export function routineArtifactRoots(stateRoot: string): {
  reports: string;
  sessions: string;
} {
  return {
    reports: join(stateRoot, "routine", "reports"),
    sessions: join(stateRoot, "routine", "sessions"),
  };
}

export function moduleSessionDirectory(input: {
  stateRoot: string;
  date: string;
  module: string;
}): string {
  return join(
    routineArtifactRoots(input.stateRoot).sessions,
    calendarDay(input.date),
    input.module,
  );
}

// Both roots hold nothing but calendar days the routine itself wrote, and every path here is built
// from one — so a purge window has no reach outside the routine's own exhaust.
export function createFileRoutineArtifactStore(
  stateRoot: string,
): RoutineArtifactStore {
  const roots = routineArtifactRoots(stateRoot);
  return {
    writeReport: async ({ date, text }) => {
      const path = join(
        roots.reports,
        `${calendarDay(date)}${REPORT_EXTENSION}`,
      );
      await mkdir(roots.reports, { recursive: true });
      await rm(path, { force: true });
      await writeFileAtomically(path, text);
      return path;
    },
    listSessionDates: async () => await datedEntries(roots.sessions, ""),
    listReportDates: async () =>
      await datedEntries(roots.reports, REPORT_EXTENSION),
    removeSession: async (date) => {
      await rm(join(roots.sessions, calendarDay(date)), {
        recursive: true,
        force: true,
      });
    },
    removeReport: async (date) => {
      await rm(join(roots.reports, `${calendarDay(date)}${REPORT_EXTENSION}`), {
        force: true,
      });
    },
  };
}

async function datedEntries(root: string, suffix: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => (suffix === "" ? entry.isDirectory() : entry.isFile()))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(suffix))
    .map((name) => name.slice(0, name.length - suffix.length))
    .filter(isCalendarDay);
}

function calendarDay(value: string): string {
  if (!isCalendarDay(value)) {
    throw new OperationalError(
      "invalid-arguments",
      `A routine artifact is named for a calendar day; received "${value}".`,
    );
  }
  return value;
}
