import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NTU_AY2026_27_SEMESTER_1,
  ntuWeeklyClassSchedule,
} from "../../src/calendar/ntu-academic-calendar.js";

describe("NTU AY2026-27 Semester 1 calendar", () => {
  it("keeps the official teaching-week map", () => {
    assert.deepEqual(
      NTU_AY2026_27_SEMESTER_1.teachingWeeks.map(({ week, start, end }) => ({
        week,
        start,
        end,
      })),
      [
        { week: 1, start: "2026-08-10", end: "2026-08-14" },
        { week: 2, start: "2026-08-17", end: "2026-08-21" },
        { week: 3, start: "2026-08-24", end: "2026-08-28" },
        { week: 4, start: "2026-08-31", end: "2026-09-04" },
        { week: 5, start: "2026-09-07", end: "2026-09-11" },
        { week: 6, start: "2026-09-14", end: "2026-09-18" },
        { week: 7, start: "2026-09-21", end: "2026-09-25" },
        { week: 8, start: "2026-10-05", end: "2026-10-09" },
        { week: 9, start: "2026-10-12", end: "2026-10-16" },
        { week: 10, start: "2026-10-19", end: "2026-10-23" },
        { week: 11, start: "2026-10-26", end: "2026-10-30" },
        { week: 12, start: "2026-11-02", end: "2026-11-06" },
        { week: 13, start: "2026-11-09", end: "2026-11-13" },
      ],
    );
  });

  it("omits public-holiday and Students' Union Day class dates", () => {
    const monday = ntuWeeklyClassSchedule({
      weekday: "MO",
      weeks: { from: 1, to: 13 },
      startTime: "09:30",
      endTime: "11:20",
    });
    assert.equal(monday.dates[0], "2026-08-17");
    assert.equal(monday.dates.at(-1), "2026-11-02");
    assert.equal(monday.dates.length, 11);
    assert.deepEqual(monday.recurrence, [
      "RRULE:FREQ=WEEKLY;UNTIL=20261109T155959Z",
      "EXDATE;TZID=Asia/Singapore:20261109T093000",
    ]);

    const friday = ntuWeeklyClassSchedule({
      weekday: "FR",
      weeks: { from: 1, to: 13 },
      startTime: "10:30",
      endTime: "11:20",
    });
    assert.equal(friday.dates.includes("2026-09-04"), false);
    assert.equal(friday.dates.length, 12);
    assert.deepEqual(friday.recurrence, [
      "RRULE:FREQ=WEEKLY;UNTIL=20261113T155959Z",
      "EXDATE;TZID=Asia/Singapore:20260904T103000",
    ]);
  });

  it("keeps explicit bounded weeks and single-week events exact", () => {
    const bounded = ntuWeeklyClassSchedule({
      weekday: "MO",
      weeks: { from: 1, to: 10 },
      startTime: "12:30",
      endTime: "14:20",
    });
    assert.equal(bounded.dates.length, 9);
    assert.equal(bounded.dates.at(-1), "2026-10-19");
    assert.deepEqual(bounded.recurrence, [
      "RRULE:FREQ=WEEKLY;UNTIL=20261019T155959Z",
    ]);

    const oneWeek = ntuWeeklyClassSchedule({
      weekday: "FR",
      weeks: { week: 12 },
      startTime: "18:30",
      endTime: "21:20",
    });
    assert.deepEqual(oneWeek.dates, ["2026-11-06"]);
  });
});
