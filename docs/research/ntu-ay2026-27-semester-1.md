# NTU AY2026-27 Semester 1 calendar

Research date: 2026-08-14 (Asia/Singapore)

## Primary sources

- [NTU Academic Calendar AY2026-27 (Semester)](https://www.ntu.edu.sg/docs/default-source/office-of-academic-services/ntu-academic-calendar-ay2026-27-%28semester%29.pdf?sfvrsn=2c3b7abf_1), published 19 March 2026.
- [NTU academic calendars](https://www.ntu.edu.sg/admissions/matriculation/academic-calendars).
- [NTU undergraduate examination timetable](https://wis.ntu.edu.sg/webexe/owa/exam_timetable_und.main).
- [NTU Semester 1 class schedule](https://wis.ntu.edu.sg/webexe/owa/aus_schedule.main).
- [Google Calendar recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents).

The NTU PDF says that dates are subject to change at the University's discretion. Final exam
seating information is released separately and exam information can change.

## Teaching-week dates

| Week | Monday-Friday dates |
| --- | --- |
| Wk1 | 10-14 Aug 2026 |
| Wk2 | 17-21 Aug 2026 |
| Wk3 | 24-28 Aug 2026 |
| Wk4 | 31 Aug-4 Sep 2026 |
| Wk5 | 7-11 Sep 2026 |
| Wk6 | 14-18 Sep 2026 |
| Wk7 | 21-25 Sep 2026 |
| Recess | 28 Sep-2 Oct 2026 |
| Wk8 | 5-9 Oct 2026 |
| Wk9 | 12-16 Oct 2026 |
| Wk10 | 19-23 Oct 2026 |
| Wk11 | 26-30 Oct 2026 |
| Wk12 | 2-6 Nov 2026 |
| Wk13 | 9-13 Nov 2026 |

Teaching runs from 10 August to 13 November 2026. Revision and examinations run from
16 November to 4 December 2026.

## Calendar exceptions

- 10 August: Monday replacement holiday for National Day; no classes.
- 4 September, 10:30-14:30: Students' Union Day; no undergraduate classes.
- 7 November: Deepavali eve; classes end at 14:30 if scheduled.
- 9 November: Monday replacement holiday for Deepavali; no classes.

The date map in `src/calendar/ntu-academic-calendar.ts` is the machine-readable copy used when
turning a private timetable manifest into a Proposal. It intentionally contains no personal
timetable, Google Calendar ID, event ID or credential.

## Exam-source handling

The private timetable manifest accepts timed exam entries. Exact personal course, date, time and
room data stay outside this public repository. The official NTU undergraduate examination timetable
is the verification source before a private Proposal is promoted; NTU may change exam information
and releases final seating separately.

Likewise, a private timetable's multiple room options remain details on one event. The importer
does not publish or duplicate personal room allocations in this repository.
