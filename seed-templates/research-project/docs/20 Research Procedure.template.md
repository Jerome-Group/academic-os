# Research Procedure

The ordinary flow is supervisor meeting -> learning or exercises -> session record. Research
promotion is an optional gated follow-up. A meeting can contain any number of sessions.

## Meeting cycle

Use the calendar-confirmed folder in `20 Supervisor Meetings/`. It contains `Meeting.md`, `Sources/`,
`10 Learning/` and `20 Exercises/`. `Meeting.md` records lifecycle status, the agenda, attributed
guidance, decisions, assignments, follow-ups and promotion decisions; it is not the teaching
transcript.

Route ordinary mathematical work to one meeting before creating an artifact. Source-led learning,
source-free Owner questions, exploratory mathematics and research discussion use `10 Learning/`;
assigned problems use `20 Exercises/`. Continue an existing unit or set whenever the object is the
same. If no meeting owns the work, park for Owner meeting selection; Research is not a fallback.
Maintenance, canonical source intake and Deliverables follow their own routes.

Create only the next few confirmed meeting folders. A calendar occurrence needs no empty folder
months in advance.

## Session records

Every invocation that teaches or works exercises writes one sequential record from
`60 Templates/session-record.md` in the relevant area's `records/`. One unit or exercise set may
have several records. The record distinguishes:

- `kind: session` — guided work or coverage;
- `kind: understanding` — the stated scope was demonstrated unaided.

Records name the source passage, Owner question or supervisor assignment that started the work;
Source IDs and locators appear only when used. They also name artifacts, what landed, unresolved
work and promotion candidates. They supersede rather than disappear.

## Learning

Use `10 Learning/` for source-led reconstruction, source-free Owner questions, exploratory
mathematics and research discussion. Create one numbered unit for the bounded subject, not for each
invocation. Continue the same unit across later sessions and add a new record each time.

Read `60 Templates/preferences.md`. For source-led work, follow source order. For a source-free
question, preserve the exact Owner question or supervisor assignment and work in dependency order.
State the result or current target, explain it at the Owner's depth, test an example, then ask for
something back. Start every durable walkthrough from `60 Templates/learning-walkthrough.tex`. The
`.tex` exists during the session; compile and inspect its PDF when the Owner is ready to retain it.

## Exercises

Use `20 Exercises/` for supervisor exercises and assigned problem sets. One set has one numbered
folder and can span many sessions. Follow the Academic OS exercise pattern:

1. Preserve the Owner's attempt when one exists, suffixed `_Attempt`.
2. Work question by question from the Owner's reasoning. After discussing a question, give and
   retain the full model solution before moving on.
3. If grading is requested or an attempt exists, write specific feedback and honest marks using
   `60 Templates/graded-feedback.tex`; state what authority the grading used.
4. Produce the complete solution set from `60 Templates/exercise-solutions.tex`.
5. Produce a distinct concepts consolidation from `60 Templates/exercise-concepts.tex`, based on
   session records rather than repeating solutions.

Generated solutions are guided-session artifacts, not evidence of unaided mastery. Unworked or
artifact-only questions remain explicitly incomplete.

## Research promotion

`70 Research/` holds selected project-facing results; it is not the ordinary working or teaching
workspace. Promotion may follow a session in the same invocation or later, but only when the Owner
has explicitly selected and adopted the material. Promotion requires:

1. the Owner selects a concept, argument or synthesis worth retaining;
2. the relevant session records and every applicable Source locator are complete;
3. the Owner reconstructs, rewrites or explicitly adopts the mathematics;
4. assistance is recorded when material;
5. a promotion record from `60 Templates/promotion-record.md` names the meeting inputs and target.

Reusable concepts go to `70 Research/10 Concepts/<thread>/` from
`60 Templates/research-concept.tex`. Synthesis, proof work and project-facing mathematical PDFs go
to `70 Research/20 Research Notes/<thread>/` from `60 Templates/research-note.tex`. Meeting PDFs
remain where they were created.

A session closes normally without promotion. Record a candidate or `none`; neither creates a
Research artifact or leaves the session incomplete.

## Research Map, Questions and Claims

The Research Map joins stable threads to meeting units, exercise sets, session records and promoted
artifacts. It creates no separate teaching workspace. Update it after paths exist.

`QUESTIONS.md` holds mathematical unknowns. `CLAIMS.md` holds candidate, checked, refuted or
superseded statements. A Claim becomes checked only from an Owner-adopted Research artifact with
verified locators; a meeting session alone cannot check it. `GLOSSARY.md` holds subject language.

## Meeting settlement

After the meeting:

1. attribute guidance and settle every assignment row;
2. ensure every learning/exercise invocation has a record;
3. change Tasks only for work explicitly reported complete and next actions explicitly accepted;
   use academic-os task tools, verify the provider result, then refresh the register;
4. resolve an exact meeting or deliverable date only through Calendar preview and verified promotion;
5. perform only promotions whose Owner selection and adoption are already explicit;
6. obtain Owner confirmation;
7. mark the meeting confirmed and verify all registered paths.

Never infer completion, acceptance, a do-date, a confirmed meeting or a promotion from coverage or
an unattended closeout.

An unconfirmed cycle remains in `20 Supervisor Meetings/` with honest `Meeting.md` status.
Incomplete mathematics can remain there with honest artifact status.
No Research promotion is required for settlement.
