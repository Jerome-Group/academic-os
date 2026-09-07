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
| `20 Tutorials/`   | tutorial path, or a structured tutorial block's `block` | tutorial |
| `30 Revision/`    | exact Source-map topic                                  | lecture  |
| `40 Past Papers/` | exact paper or paper folder                             | tutorial |

A target is the item worked. Its `unit` is the Source-map key that governs it. Several tutorials or
papers may share one unit and remain separate targets. Each area keeps `records/` beside its target
folders.

The lecture pattern produces walkthroughs from the target's sources. Revision applies it to one
topic, following tutorial and paper pointers without copying them. The tutorial pattern preserves
the Owner's attempt and produces grading, a solution writeup, and a concepts consolidation.

## Session path

### 1. Resolve the activity and target

Use the activity and target the Owner named when they resolve exactly. Otherwise enumerate that
activity's real targets from the Source Map and workspace, then compare each target with the area's
records. Select the earliest target with no completed coverage in the source order already present.
Ask when the request matches nothing, no order exists, or several targets have an equal claim.

Legacy records without `target` are evidence, not automatic completion. Resolve their target from
their sources and folder only when that evidence identifies one target exactly; ask when it does
not. A record for one tutorial or paper never covers another under the same unit.

State the resolved area, target, governing unit, and sources before work begins.

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

A lecture target produces walkthroughs, usually about three for a unit unless the source's own
structure justifies another split. A tutorial or past paper preserves the attempt and produces a
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
The body says what was covered, produced, demonstrated, unresolved, and worth revisiting.

`kind: session` records coverage. `kind: understanding` requires the body to name what the Owner
demonstrated unaided and the exact scope of that evidence. `status` reports whether the requested
target finished; it does not assert mastery. A record's existence alone proves neither completion
nor understanding. Replacements append and leave the superseded record intact.

### 7. Close out

Surface unresolved sources, mathematical uncertainty, uncompiled output, and parked choices. Add a
`REVISIT.md` entry only for confusion, a question the Owner was completely stuck on, or an
exam-important question the Owner accepts; keep the existing no-date, no-order form.

Reconcile only work explicitly completed and next actions the Owner accepted through the
authoritative Tasks tools, verify the push, then refresh the Task Register. Resolve authoritative
assessment dates through Calendar preview and promotion. Preserve task IDs and unrelated fields.
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
