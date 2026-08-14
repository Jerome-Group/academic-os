# NTU academic timetable import is a private bulk Proposal

The supplied NTU timetable is represented by a private manifest consumed by `calendar propose`.
The manifest identifies classes by weekday, local time, room, and teaching-week range, plus timed
exam entries. It is never committed because the repository is public and exact personal schedules
belong to the private Calendar workspace.

The public machine-readable date map is `src/calendar/ntu-academic-calendar.ts`, backed by the
official [NTU AY2026-27 Semester 1 calendar](https://www.ntu.edu.sg/docs/default-source/office-of-academic-services/ntu-academic-calendar-ay2026-27-%28semester%29.pdf?sfvrsn=2c3b7abf_1).
An omitted week range means Wk1-Wk13. The map removes official replacement holidays and the
Students' Union Day undergraduate no-class interval. A multi-week class becomes one bounded
Google recurring master with explicit exceptions; a single-week class and every exam become one
timed event. Multiple possible rooms stay as details on one event.

The importer checks every expanded occurrence against current Owned and selected Observed
availability and writes one bulk Proposal. Promotion remains the only Google event-write path.
The operator must review the exact preview and explicitly promote it. A later NTU calendar change
requires a new Proposal rather than silently mutating an existing series.

## Rejected

- Committing the image or a personal timetable: violates the repository's public/private boundary.
- Creating one event per room option: produces overlapping duplicates.
- Publishing directly from the importer: bypasses the calendar authority, conflict check and
  Promotion review path.
