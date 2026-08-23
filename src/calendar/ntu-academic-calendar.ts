export type NtuWeekday = "MO" | "TU" | "WE" | "TH" | "FR";

export type NtuWeekSelection = { from: number; to: number } | { week: number };

export interface NtuNoClassException {
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}

export const NTU_AY2026_27_SEMESTER_1 = {
  schemaVersion: 1 as const,
  term: "AY2026-27-S1" as const,
  timezone: "Asia/Singapore" as const,
  source: {
    title: "NTU Academic Calendar AY2026-27 (Semester)",
    published: "2026-03-19",
    url: "https://www.ntu.edu.sg/docs/default-source/office-of-academic-services/ntu-academic-calendar-ay2026-27-%28semester%29.pdf?sfvrsn=2c3b7abf_1",
  },
  teachingWeeks: [
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
  recess: { start: "2026-09-28", end: "2026-10-02" },
  revisionAndExamination: { start: "2026-11-16", end: "2026-12-04" },
  noClassExceptions: [
    {
      date: "2026-08-10",
      startTime: "00:00",
      endTime: "23:59",
      reason: "National Day replacement holiday",
    },
    {
      date: "2026-09-04",
      startTime: "10:30",
      endTime: "14:30",
      reason: "Students' Union Day: no undergraduate classes",
    },
    {
      date: "2026-11-09",
      startTime: "00:00",
      endTime: "23:59",
      reason: "Deepavali replacement holiday",
    },
  ] satisfies readonly NtuNoClassException[],
  earlyClose: {
    date: "2026-11-07",
    endTime: "14:30",
    reason: "Deepavali eve early close",
  },
} as const;

export interface NtuWeeklyClassTiming {
  weekday: NtuWeekday;
  weeks: NtuWeekSelection;
  startTime: string;
  endTime: string;
}

export interface NtuWeeklyClassSchedule {
  startDate: string;
  dates: string[];
  recurrence: string[];
}

export function datesForNtuWeeks(
  weeks: NtuWeekSelection,
  weekday: NtuWeekday,
): string[] {
  const selectedWeeks =
    "week" in weeks
      ? [weeks.week]
      : Array.from(
          { length: weeks.to - weeks.from + 1 },
          (_, index) => weeks.from + index,
        );
  return selectedWeeks.map((week) => {
    const entry = NTU_AY2026_27_SEMESTER_1.teachingWeeks.find(
      (candidate) => candidate.week === week,
    );
    if (entry === undefined) {
      throw new Error(`Unknown NTU teaching week: ${week.toString()}`);
    }
    return addDays(entry.start, weekdayOffset(weekday));
  });
}

export function ntuWeeklyClassSchedule(
  input: NtuWeeklyClassTiming,
): NtuWeeklyClassSchedule {
  validateTime(input.startTime, "startTime");
  validateTime(input.endTime, "endTime");
  if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
    throw new Error("Class endTime must be after startTime.");
  }
  const rawDates = datesForNtuWeeks(input.weeks, input.weekday);
  const dates = rawDates.filter(
    (date) => !isExcluded(date, input.startTime, input.endTime),
  );
  const firstDate = dates[0];
  const lastDate = rawDates.at(-1);
  if (firstDate === undefined || lastDate === undefined) {
    throw new Error("The NTU timetable selection has no class dates.");
  }
  const excludedDates = weeklyOccurrences(firstDate, lastDate).filter(
    (date) => !dates.includes(date),
  );
  const recurrence = [
    `RRULE:FREQ=WEEKLY;UNTIL=${utcRecurrenceBoundary(lastDate)}`,
    ...excludedDates.map(
      (date) =>
        `EXDATE;TZID=Asia/Singapore:${localRecurrenceDate(date, input.startTime)}`,
    ),
  ];
  return { startDate: firstDate, dates, recurrence };
}

export function localNtuDateTime(date: string, time: string): string {
  validateTime(time, "time");
  return `${date}T${time}:00+08:00`;
}

function isExcluded(date: string, startTime: string, endTime: string): boolean {
  return NTU_AY2026_27_SEMESTER_1.noClassExceptions.some(
    (exception) =>
      exception.date === date &&
      toMinutes(startTime) < toMinutes(exception.endTime) &&
      toMinutes(endTime) > toMinutes(exception.startTime),
  );
}

// Recess is a gap in the teaching-week map rather than a same-day exception, so the exclusions
// cannot come from the class dates: a recess week is absent from those, never excluded by them.
function weeklyOccurrences(firstDate: string, lastDate: string): string[] {
  const occurrences: string[] = [];
  for (let date = firstDate; date <= lastDate; date = addDays(date, 7)) {
    occurrences.push(date);
  }
  return occurrences;
}

function weekdayOffset(weekday: NtuWeekday): number {
  return { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4 }[weekday];
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function validateTime(time: string, name: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)) {
    throw new Error(`${name} must be HH:mm.`);
  }
}

function localRecurrenceDate(date: string, time: string): string {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function utcRecurrenceBoundary(date: string): string {
  return `${date.replaceAll("-", "")}T155959Z`;
}
