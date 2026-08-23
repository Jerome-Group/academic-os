import { calendarDaysBetween } from "./offering-calendar-day.js";
import type { RetentionPurge } from "./types.js";

export const SESSION_RETENTION_DAYS = 7;
export const REPORT_RETENTION_DAYS = 30;

// The routine keeps its own exhaust off the mini, and only its own: the store hands over the dates
// it named, so a window can never reach anything the routine did not write.
export function planRetentionPurge(input: {
  today: string;
  sessionDates: readonly string[];
  reportDates: readonly string[];
}): RetentionPurge {
  return {
    sessions: expired(input.sessionDates, input.today, SESSION_RETENTION_DAYS),
    reports: expired(input.reportDates, input.today, REPORT_RETENTION_DAYS),
  };
}

function expired(
  dates: readonly string[],
  today: string,
  retentionDays: number,
): string[] {
  return dates
    .filter((date) => calendarDaysBetween(date, today) > retentionDays)
    .sort();
}
