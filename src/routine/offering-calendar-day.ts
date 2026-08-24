export const OFFERING_TIMEZONE = "Asia/Singapore";

const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

// ADR-0012: a date this system records is a calendar day in the offering's timezone. A run that
// fires at 06:00 local sits eight hours ahead of the instant's UTC half, so the day is read off the
// offering's clock rather than sliced out of an ISO stamp.
export function offeringCalendarDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFERING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function isCalendarDay(value: string): boolean {
  return (
    CALENDAR_DAY_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

export function calendarDaysBetween(earlier: string, later: string): number {
  return Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) /
      86_400_000,
  );
}
