import type { OwnedCalendarMirror } from "./types.js";

export const CALENDAR_REFRESH_QUERY = {
  singleEvents: false,
  showDeleted: true,
} as const;

export function hasCalendarRefreshBinding(
  mirror: OwnedCalendarMirror | undefined,
  target: { calendarId: string; managementHorizon: string },
): boolean {
  const query = mirror?.syncQuery;
  return (
    mirror?.calendarId === target.calendarId &&
    mirror.managementHorizon === target.managementHorizon &&
    typeof query === "object" &&
    query !== null &&
    Object.keys(query).length === Object.keys(CALENDAR_REFRESH_QUERY).length &&
    query.singleEvents === CALENDAR_REFRESH_QUERY.singleEvents &&
    query.showDeleted === CALENDAR_REFRESH_QUERY.showDeleted
  );
}
