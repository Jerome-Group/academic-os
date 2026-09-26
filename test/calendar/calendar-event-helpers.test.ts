import assert from "node:assert/strict";
import { it } from "node:test";

import { eventContainsPatch } from "../../src/calendar/calendar-event-helpers.js";
import { trimCalendarRecurrence } from "../../src/calendar/calendar-recurrence.js";

it("treats missing patched fields as a mismatch without throwing", () => {
  assert.equal(
    eventContainsPatch({ id: "event" }, { description: "new" }),
    false,
  );
});

it("verifies provider-normalized instants while rejecting a changed time or timezone", () => {
  const patch = {
    start: {
      dateTime: "2026-10-01T11:00:00+08:00",
      timeZone: "Asia/Singapore",
    },
  };
  assert.equal(
    eventContainsPatch(
      { id: "event", start: { dateTime: "2026-10-01T03:00:00Z" } },
      patch,
    ),
    true,
  );
  assert.equal(
    eventContainsPatch(
      { id: "event", start: { dateTime: "2026-10-01T04:00:00Z" } },
      patch,
    ),
    false,
  );
  assert.equal(
    eventContainsPatch(
      {
        id: "event",
        start: { dateTime: "2026-10-01T03:00:00Z", timeZone: "Europe/London" },
      },
      patch,
    ),
    false,
  );
  assert.equal(
    eventContainsPatch(
      { id: "event", start: { date: "2026-10-02" } },
      { start: { date: "2026-10-01" } },
    ),
    false,
  );
});

it("trims an all-day recurrence with a date-valued inclusive UNTIL", () => {
  assert.deepEqual(
    trimCalendarRecurrence(["RRULE:FREQ=DAILY;COUNT=10"], "2026-10-03"),
    ["RRULE:FREQ=DAILY;UNTIL=20261002"],
  );
});
