import { createHash } from "node:crypto";

export function calendarEventIdFor(idempotencyKey: string): string {
  return `a${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 31)}`;
}
