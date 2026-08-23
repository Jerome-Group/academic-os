import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NTU_AY2026_27_SEMESTER_1,
  type NtuWeeklyClassSchedule,
  ntuWeeklyClassSchedule,
} from "../../src/calendar/ntu-academic-calendar.js";

// What a calendar client actually shows: the weekly rule expanded across the term, minus the dates
// the series excludes. The generator is right only when that equals the class dates it reports —
// an occurrence the rule invents and no EXDATE removes is a class in the Owner's calendar that the
// term does not have.
function occurrencesOf({
  startDate,
  recurrence,
}: NtuWeeklyClassSchedule): string[] {
  const until = calendarDate(
    recurrence.find((line) => line.startsWith("RRULE:")),
  );
  const excluded = new Set(
    recurrence
      .filter((line) => line.startsWith("EXDATE"))
      .map((line) => calendarDate(line)),
  );
  const occurrences: string[] = [];
  for (let date = startDate; date <= until; date = addWeek(date)) {
    if (!excluded.has(date)) {
      occurrences.push(date);
    }
  }
  return occurrences;
}

// Both an `UNTIL=` and an `EXDATE:` carry the same `YYYYMMDD` stamp, so one reader serves both.
function calendarDate(line: string | undefined): string {
  const stamp = /(\d{4})(\d{2})(\d{2})T/u.exec(line ?? "");
  if (stamp === null) {
    throw new Error(`No calendar date in: ${line ?? "(missing line)"}`);
  }
  return stamp.slice(1).join("-");
}

function daysBetween(from: string, to: string): number {
  const span = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return span / (24 * 60 * 60 * 1000);
}

function addWeek(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString().slice(0, 10);
}

describe("NTU AY2026-27 Semester 1 calendar", () => {
  it("excludes every week the rule invents and the term does not have", () => {
    for (const weekday of ["MO", "TU", "WE", "TH", "FR"] as const) {
      const series = ntuWeeklyClassSchedule({
        weekday,
        weeks: { from: 1, to: 13 },
        startTime: "10:30",
        endTime: "12:20",
      });

      assert.deepEqual(occurrencesOf(series), series.dates, weekday);
    }
  });

  // The test above is an identity over whatever the generator emits, so it catches a revert and
  // nothing else. This one names the week the term actually skips, read off the declared window.
  it("puts no class inside the recess week, whatever the series", () => {
    const { recess } = NTU_AY2026_27_SEMESTER_1;

    for (const weekday of ["MO", "TU", "WE", "TH", "FR"] as const) {
      const series = ntuWeeklyClassSchedule({
        weekday,
        weeks: { from: 1, to: 13 },
        startTime: "10:30",
        endTime: "12:20",
      });

      assert.deepEqual(
        occurrencesOf(series).filter(
          (date) => date >= recess.start && date <= recess.end,
        ),
        [],
        weekday,
      );
    }
  });

  // A weekly rule steps seven days from the first class, so it lands on a later teaching week only
  // while the map's weeks stay a whole number of weeks apart. A gap of any other length would put
  // real classes off the rule's grid, where no exclusion can reach them either.
  it("keeps every teaching week a whole number of weeks from the first", () => {
    const [first, ...rest] = NTU_AY2026_27_SEMESTER_1.teachingWeeks;
    if (first === undefined) {
      throw new Error("The teaching-week map is empty.");
    }

    for (const { week, start } of rest) {
      assert.equal(daysBetween(first.start, start) % 7, 0, `week ${week}`);
    }
  });

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
      "EXDATE;TZID=Asia/Singapore:20260928T093000",
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
      "EXDATE;TZID=Asia/Singapore:20261002T103000",
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
      "EXDATE;TZID=Asia/Singapore:20260928T123000",
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
