// A Do-date is the day work is planned, and neither the register nor Google's `due` can carry a
// time — so one shape check answers for both directions.
export function isDoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

// Google records only the date half of `due` and discards the time, so a push sends midnight UTC
// and a pull mirrors the date it can read back and never a time it cannot.
export function liveDue(doDate: string): string {
  return `${doDate}T00:00:00.000Z`;
}

export function liveDoDate(due: string | undefined): string | undefined {
  const date = due?.slice(0, 10);
  return isDoDate(date) ? date : undefined;
}
