# Teaching Procedure

How MODULE_CODE is worked through in `70 Learning/`. A session selects one activity target, works
from its exact sources, leaves durable artifacts, and records only what happened.

Read `00 Module Admin/40 Source Map.yaml` and
`70 Learning/templates/preferences.md` before every session. If
`70 Learning/preferences.local.md` exists, read it afterwards; it may refine the shared preferences
for this module. `docs/00 Structure and Naming.md` governs anything that leaves this workspace.

## Activity targets

| Area              | Target                                                  | Pattern  |
| ----------------- | ------------------------------------------------------- | -------- |
| `10 Lectures/`    | Source-map unit key                                     | lecture  |
| `20 Tutorials/`   | tutorial path, tutorial block, or module `exercise_sets` block | tutorial |
| `30 Revision/`    | exact Source-map topic                                  | lecture  |
| `40 Past Papers/` | exact paper or paper folder                             | tutorial or Final Review |

A target is the item worked. A unit-level target's `unit` is the Source-map key that governs it.
A module-level exercise set carries its declared `units` scope; never assign the whole set to one
handout. It uses the tutorial pattern and its own named folder in `20 Tutorials/`, retaining its
review identity even when its issued sources live in Finals. Select it with
`academic-os learning exercise --root <module-root> --target <block> --json`; this reads sources
and returns checksums and scope without writing records or completing work. Several tutorials or
papers may share one unit and remain separate targets. Each area keeps `records/` beside its target
folders.

The lecture pattern produces walkthroughs from the target's sources. Revision applies it to one
topic, following tutorial and paper pointers without copying them. The tutorial pattern preserves
the Owner's attempt and produces grading, a solution writeup, and a concepts consolidation.

## Past finals

A named final defaults to a full attempt under the tutorial pattern. An explicit review request
or a task titled `<module> <year> Final Review` selects a 30-minute Final Review. Both use the
same paper target. Call `tasks_final_study` with `action=inspect`, the configured semester and
current Module, and the paper title or exact question-file path as `request`. Prefix that value
with `review ` for review mode. For an ambiguous paper, ask the Owner to select an exact question
file and keep the requested mode.
Historical codes resolve only when the curated questions identify them for this Module. Use the
returned question file and paired solutions, or report an unavailable source. Exact papers and
paper folders remain valid attempt targets. When the tool is unavailable, identify the exact
questions and paired solutions from the curated Finals inventory before teaching, and leave
Task closeout pending.

Use the fresh register entry to select the exact task. Prefer an existing open task in the
requested mode, including one the Owner renamed or recreated. Ask which task to use when
several have an equal claim. If the task's title could mean several papers, get the Owner's
exact question-file choice and use that path as the request, prefixed with `review` for a
review. If the Owner accepts changing the mode of an open task for this
paper, call `tasks_final_study` with `action=switch` and that `task_id`. If a separate task
is needed and the Owner accepts creating it, use the Tasks protocol with the canonical title
and question file as `assessment` provenance. Refresh after an uncertain create before retrying.

For Final Review, use about 5 minutes to survey the paper, 20 to elicit an approach and compare
it with available solutions question by question, and 5 to name gaps and agreed revisit items.
Record the questions actually covered. Identify issued solutions by source and label any
agent-produced explanation **Generated walkthrough**. A review needs no submitted script,
mark, or graded feedback. Use the existing paper folder when it can be identified exactly.

Record review coverage separately in the area's next numbered session record. Use the canonical
paper title as `target` and `mode: final-review`. Include the exact question file in
`sources` and cite the question and solution locators actually used. Include `task_id` when
a task was selected. Set `status: complete` only when the Owner explicitly finishes the review.
Keep this record on closeout retry so later task renames and refreshes
retain the review evidence. Use a governing unit only when the Source Map establishes one.
Preserve any previous attempt, feedback, and records. Record a later full attempt separately.

When the Owner explicitly finishes the review, call `tasks_final_study` with
`action=complete-review`, the review request and the selected `task_id`. Confirm the same
ID reads completed and the canonical entry reports `reviewed`. A full attempt uses the
ordinary Tasks protocol and its own attempt task. If retrying a review, keep the same paper
and task ID. A completed attempt task and a completed review can both contribute coverage to
one entry. Grading and understanding come from their own evidence.

## Session path

### 1. Resolve the activity and target

Use the activity and target the Owner named when they resolve exactly. Otherwise enumerate that
activity's real targets from the Source Map and workspace, then compare each target with the area's
records. Select the earliest target with no completed coverage in the source order already present.
Ask when the request matches nothing, no order exists, or several targets have an equal claim.

Legacy records without `target` are evidence, not automatic completion. Resolve their target from
their sources and folder only when that evidence identifies one target exactly; ask when it does
not. A record for one tutorial or paper never covers another under the same unit.

State the resolved area, target, governing unit or declared units scope, and sources before work begins.

### 2. Declare the write set

Name every file and exact region this session may change before writing:

- importer material, issued sources, and Owner attempts: read or copy; retain original bytes;
- generated `.tex`, PDFs, and feedback: create or update only inside the resolved target folder;
- `GLOSSARY.md`, `RESOURCES.md`, and `REVISIT.md`: append or change the identified entry;
- Source Map: update the identified unit, target, or source entry while preserving every other key;
- records: append a new numbered record, or append a replacement naming `supersedes`.

Authorization for the requested session persists through these routine reversible steps. Ask only
when an unresolved choice changes the academic result or durable placement.

### 3. Work from the exact sources

Read every selected file and locator. Follow the Source Map's order. Preserve module notation and
vocabulary. A structured tutorial block's `missing` entries are evidence that solutions are absent,
not permission to claim an official answer.

Teach under the shared preferences and any local overlay: explain, ask for something back, and
follow the demonstrated doubt. The Owner's current instruction remains authoritative.

### 4. Produce only the activity's artifacts

A Final Review follows the artifact instructions in **Past finals**. A lecture target produces
walkthroughs, usually about three for a unit unless the source's own
structure justifies another split. A tutorial, exercise set or full past-paper attempt preserves the attempt and produces a
full solution writeup and concepts consolidation. Revision produces topic notes or a reference
sheet as the actual work requires. Keep each `.tex` beside its PDF in the target folder.

The Owner's annotated attempt is immutable source evidence. Copy it into the target folder when
needed and append `_Attempt` to its name; add a date only for a later attempt at the same target.
Never rewrite an attempt while grading it.

For grading, read the question first, then compare against issued solutions or verified reputable
solutions where available. When none exists, label the grade as the agent's checked reading. Record
the real mark and exact error in a graded-feedback PDF. Grading alone proves no understanding.

### 5. Verify the result

Check every mathematical claim against the selected sources or state its independent derivation.
Compile changed LaTeX with:

```bash
latexmk -pdf -auxdir=build
```

The PDF remains beside its `.tex`; `build/` contains disposable auxiliary output. Inspect the
rendered pages at a scale proportionate to the change, including equations, glyphs, overflow, and
page boundaries. When compilation tooling is unavailable, retain the `.tex`, record the missing
PDF, and park only that output.

Completion means every changed artifact is source-accounted, mathematically checked, compiled when
possible, and visually inspected where rendering changed.

### 6. Record truthful evidence

Append `NNNN-slug.md` in the area's `records/`, sequential within that area:

```yaml
---
date: 2026-08-17
unit: <Source-map key>
target: <exact activity target>
sources:
  - file: <module-relative source path>
    locator: <slides, sections, exercises, or pages actually used>
kind: session | understanding
status: complete | partial | parked
supersedes: NNNN
---
```

Omit `sources` only when the whole declared target was used, and omit `supersedes` for a new record.
For a module-level exercise set, replace `unit` with `units: [<exact declared keys>]`; `target` is
the exact block. Record a question subset in `sources[].locator` and the body; completing a subset
does not complete the whole set. Existing single-unit records stay unchanged.
The body says what was covered, produced, demonstrated, unresolved, and worth revisiting.

`kind: session` records coverage. `kind: understanding` requires the body to name what the Owner
demonstrated unaided and the exact scope of that evidence. `status` reports whether the requested
target finished; it does not assert mastery. A record's existence alone proves neither completion
nor understanding. Replacements append and leave the superseded record intact.

### 7. Close out

Surface unresolved sources, mathematical uncertainty, uncompiled output, and parked choices. Add a
`REVISIT.md` entry only for confusion, a question the Owner was completely stuck on, or an
exam-important question the Owner accepts; keep the existing no-date, no-order form.

Reconcile only work explicitly completed and next actions the Owner accepted through the Tasks
protocol in `AGENTS.md`. Verify API/register success there; a conflict or uncertain result remains
unresolved. Date-only Task updates use ordinary API calls. Clock-time placement follows its separate
authorized native UI delegation and evidence gate. Resolve authoritative assessment dates through
Calendar preview and promotion. Preserve task IDs, manual changes, dismissals and unrelated fields.
Never infer mastery, silently reschedule overdue work, or turn an unaccepted suggestion into a task.

The session is complete when the record exists, durable artifacts and authoritative state are
verified, and every unresolved item is named.

## Workspace references

`GLOSSARY.md` holds subject language; `CONTEXT.md` holds organisational language.
`RESOURCES.md` holds external references with their use. `REVISIT.md` is the accepted revisit list;
it schedules nothing.

`templates/` contains the ordinary teaching types and the mathematics cheatsheet type. Ordinary
types use `preamble.tex`; the cheatsheet uses `mathematics-cheatsheet-preamble.tex` and
`chatgpt-logo.tex`. Start from the matching type. A module may add functional macros, environments,
or notation shortcuts; visible shared design changes for ordinary teaching types belong to the seeded set.
For creating, revising, auditing, verifying or packaging a cheatsheet, follow
`docs/40 Cheatsheet Procedure.md`; its artifact constraints govern the configured layout.
