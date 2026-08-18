// A Do-date is the day work is planned, and neither the register nor Google's `due` can carry a
// time — so one shape check answers for both directions.
export function isDoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}
