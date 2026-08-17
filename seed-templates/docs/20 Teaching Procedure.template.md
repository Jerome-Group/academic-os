# Teaching Procedure

How MODULE_CODE is worked through, in `70 Learning/`. Teaching the subject is the way of learning
it: a session takes one unit's material, produces artifacts a later session can read, and leaves a
record of what actually landed.

`00 Module Admin/40 Source Map.yaml` is the spine. Every folder and every record here names a
**unit** by its Source-map key, and the map is what says which files that unit is — so "what are
we looking at" is a lookup rather than a judgment. Material arriving for a unit the map does not yet
name extends the map; a key it already names is never re-spelled.

Names inside this workspace are this procedure's — `docs/00 Structure and Naming.md` exempts them
and governs everything that leaves.

## The four activity areas

| Area | One folder per | Pattern |
| --- | --- | --- |
| `10 Lectures/` | lecture-unit, named for its Source-map key | lecture |
| `20 Tutorials/` | tutorial | tutorial |
| `30 Revision/` | topic, taken from the Source map's `topics` | lecture |
| `40 Past Papers/` | paper | tutorial |

Each area keeps its own `records/` beside those folders, where `docs/00 Structure and Naming.md`
draws it. The two patterns:

- **The lecture pattern.** Work the unit's sources; produce walkthroughs. Revision runs it over a
  topic instead of a lecture-unit and with more sources, reaching tutorial and past-paper questions
  by pointer rather than copying them anywhere.
- **The tutorial pattern.** The Owner's attempt, graded, plus a solution writeup and a concepts
  consolidation.

Which lecture-unit is next is read off the records. The workspace keeps no cursor file.

## Records

Each area's `records/` holds numbered `NNNN-slug.md`, from `0001` and sequential within that area.
One session against one unit is one record, and its header is deterministic:

```yaml
---
date: 2026-08-17
unit: <a Source-map key>  # never a filename
sources:                  # what was actually on the table; omit when it is the whole unit
  - file: MODULE_CODE_Lecture_03A_Partial_Derivatives.pdf
    locator: slides 1-24
kind: session | understanding
supersedes: NNNN          # optional
---
```

- `unit` is a Source-map key in every area — a tutorial or a paper is recorded against the
  lecture-unit it belongs to, whatever its own folder is called.
- `sources` carries a locator per file — slides, sections, exercises — because a record's job is
  to let the next session resume at the right page.
- `kind: session` is the ordinary record. `kind: understanding` is **evidence-gated**: the body
  names what was demonstrated unaided, and the scope that demonstration holds over. Covering a
  thing is a session; showing it is understanding.
- `supersedes` names by number the record this one replaces. The superseded record stays exactly
  where it is — a record is superseded, never deleted.

The body is free-form: what was discussed, what was weak, what was strong, what is worth another
pass. "What do I actually understand" and "which lecture is next" are filters over these records,
so a record earns its place by answering one of them later.

## Lessons

Work the unit's sources in the order the Source map lists them. The artifact is a
**walkthrough** — a `.tex` beside its PDF, in the unit's folder.

**About three walkthroughs per unit folder.** More only where the source's own sectioning or a full
textbook chapter justifies it; a source that sections itself finely is worked as a whole rather
than copied section for section.

Compile beside the source, one invocation:

```bash
latexmk -pdf -outdir=build
```

The templates were cut against TeX Live 2026, and anything newer is fine. A machine that runs
teaching sessions has `latexmk` on PATH. When a session finds it missing, say so in the session,
write the `.tex` as normal, park the PDF alone, and note the uncompiled artifact in the record.
Opening a unit folder on a machine that has it compiles every `.tex` lacking a current PDF —
`latexmk` makes that idempotent, which is why parked PDFs need no queue and no list.

The package list in the seeded preamble documents what the templates use, for the session that
edits a template. It is documentation, never a checklist to verify package by package.

## Tutorials

One tutorial is one folder, and a past paper is the same shape. Each produces a full **solution
writeup** and a **concepts consolidation**, `.tex` beside PDF. The consolidation is built from the
area's records — what the tutorial taught, rather than the solutions a second time.

**The attempt.** The Owner's annotated work arrives mid-session on their say-so, dropped into the
folder. Rename it with `_Attempt` appended. A date joins the name only on a second attempt at the
same thing.

**Grading.** Reading the question correctly outranks everything else here.

- The first pass works from the questions alone, unless the module issued its own written
  solutions and its folder declares them.
- Then hunt verified solutions to grade against — official ones, or reputable unofficial ones; a
  textbook question usually has some. Your own reading stands as the grade only where the hunt
  found none, and the feedback says that is what happened.
- Record real marks and the real grade. The number the attempt actually earned is the point.
- Write a graded-feedback PDF beside the attempt; the glanceable trace of it is a record.

**Grading is a record, not a learning trigger.** A graded attempt closes into its record and goes
no further — except a tutorial the Owner completed with no help at all, which is demonstrated
understanding and earns `kind: understanding`.

## The Revisit register, glossary and resources

**`REVISIT.md`** takes three kinds of entry and no others: confusion, a question the Owner was
completely stuck on, and a question that is exam-important. Propose the entry and the Owner accepts
it in the moment; exam-importance may be nominated with evidence, and the same question recurring
across past papers is the usual evidence. Entries carry no dates, sit in no order, and feed no task
system — the Owner strikes one by hand once they have worked it through.

**`GLOSSARY.md`** is the subject speaking: the module's own terms, kept for the learning.
`AGENTS.md` carries the test that splits it from `CONTEXT.md`; apply it before minting a term in
either.

**`RESOURCES.md`** holds the external references this workspace works from — a lecturer's notes
page, a video series, a solutions archive — each with a line saying what it is good for.

## Templates

`templates/` is seeded with six types — lecture walkthrough, tutorial solution writeup, tutorial
concepts consolidation, graded feedback, revision/topic notes, reference sheet — beside the shared
preamble and the preferences file. Start every artifact from the type that matches it.

**Divergence is functional, never visual.** A module adds what makes writing its own LaTeX easier:
macros, environments, notation shortcuts. The page it renders to stays the seeded page, so PDFs
look identical across every module. A change that would show in a rendered page is a change to the
seeded set, and so the Owner's.

The preferences file carries how the Owner is taught. It is seeded like the rest, and rarely a
module's to diverge from.
