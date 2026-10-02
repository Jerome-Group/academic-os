import { isCalendarDay } from "./offering-calendar-day.js";

export function offeringWeekStart(date: string): string {
  if (!isCalendarDay(date)) throw new Error("Invalid offering calendar day.");
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() - ((instant.getUTCDay() + 6) % 7));
  return instant.toISOString().slice(0, 10);
}
