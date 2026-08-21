import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCalendarAcademicTimetableProposalInput } from "../../src/calendar/calendar-proposal-input.js";

describe("academic-timetable Proposal input", () => {
  it("expands blank weeks from the public NTU date map and keeps exams one-off", () => {
    const parsed = parseCalendarAcademicTimetableProposalInput(
      {
        schemaVersion: 1,
        source: { kind: "ntu-timetable", reference: "private-image-1" },
        item: {
          operation: "academic-timetable",
          calendarRole: "Academic",
          term: "AY2026-27-S1",
          classes: [
            {
              key: "mh2100-friday", // gitleaks:allow
              summary: "MH2100 LEC/STU LE",
              weekday: "FR",
              startTime: "10:30",
              endTime: "11:20",
              location: "SPMS-TR+17",
            },
          ],
          exams: [
            {
              key: "mh2100-exam",
              summary: "MH2100 exam - Calculus III",
              date: "2026-11-26",
              startTime: "13:00",
              endTime: "15:00",
            },
          ],
        },
      },
      "Asia/Singapore",
    );

    assert.ok(parsed);
    assert.equal(parsed.items.length, 2);
    assert.deepEqual(parsed.items[0]?.intendedEvent.recurrence, [
      "RRULE:FREQ=WEEKLY;UNTIL=20261113T155959Z",
      "EXDATE;TZID=Asia/Singapore:20260904T103000",
      "EXDATE;TZID=Asia/Singapore:20261002T103000",
    ]);
    assert.equal(parsed.items[0]?.occupiedIntervals.length, 12);
    assert.equal(parsed.items[1]?.intendedEvent.recurrence, undefined);
    assert.deepEqual(parsed.items[1]?.intendedEvent.start, {
      dateTime: "2026-11-26T13:00:00+08:00",
      timeZone: "Asia/Singapore",
    });
  });

  it("rejects a non-NTU term and duplicate private event keys", () => {
    assert.throws(
      () =>
        parseCalendarAcademicTimetableProposalInput(
          {
            schemaVersion: 1,
            source: { kind: "ntu-timetable", reference: "private-image-1" },
            item: {
              operation: "academic-timetable",
              calendarRole: "Academic",
              term: "AY2025-26-S1",
              classes: [],
              exams: [],
            },
          },
          "Asia/Singapore",
        ),
      /item\.term/u,
    );

    assert.throws(
      () =>
        parseCalendarAcademicTimetableProposalInput(
          {
            schemaVersion: 1,
            source: { kind: "ntu-timetable", reference: "private-image-1" },
            item: {
              operation: "academic-timetable",
              calendarRole: "Academic",
              term: "AY2026-27-S1",
              classes: [
                {
                  key: "same",
                  summary: "Class 1",
                  weekday: "MO",
                  startTime: "09:30",
                  endTime: "10:30",
                  weeks: { week: 2 },
                },
                {
                  key: "same",
                  summary: "Class 2",
                  weekday: "TU",
                  startTime: "09:30",
                  endTime: "10:30",
                  weeks: { week: 2 },
                },
              ],
              exams: [],
            },
          },
          "Asia/Singapore",
        ),
      /duplicate timetable event key/u,
    );
  });
});
