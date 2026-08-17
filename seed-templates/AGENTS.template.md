# What this folder is

The MODULE_CODE module folder: one module's material, laid out to a pinned
contract. This file is the router — every piece of work starts at a route
below and runs by its procedure.

## Start here

Read `CONTEXT.md` (how material is named and classified here) and
`00 Module Admin/00 Module Profile.md` (what this module is). Before
creating, naming, moving or placing any file, read
`docs/00 Structure and Naming.md` — the ground rules every route presumes.

## Routes

Read the route's procedure before acting in its area.

- **Curation** — new NTULearn material into its canonical home:
  `docs/10 Curation Procedure.md`, recording in
  `00 Module Admin/20 Curation Register.jsonl`.
- **Teaching** — lectures, revision and past papers in `70 Learning/`:
  `docs/20 Teaching Procedure.md`, with lecture-units in
  `00 Module Admin/40 Source Map.yaml`.
- **Tutorials** — curated sheets in `20 Tutorials/`; attempts, grading and
  writeups in `70 Learning/20 Tutorials/`: `docs/20 Teaching Procedure.md`.
- **Textbooks** — chapters into `10 Learning Materials/20 Textbook Chapters/`:
  `docs/30 Textbook Procedure.md`, recording in
  `00 Module Admin/50 Textbook Register.yaml`.
- **Tasks** — module tasks go through the academic-os task tools, mirrored in
  `00 Module Admin/30 Task Register.yaml`. A task carries a do-date only; a
  deadline is a Calendar milestone, owned outside this folder. When the task
  tools are absent, the operation parks.
- **Assessments** — graded-work artifacts in `30 Assessments/`, placed per
  the structure doc.
- **Projects/Labs** — `40 Projects and Labs/`, placed per the structure doc.
- **Maintenance** — structure questions, definition and profile updates:
  `docs/00 Structure and Naming.md` and
  `00 Module Admin/10 Module Definition.yaml`.

## Domain language

`CONTEXT.md` is this module's organisational language;
`70 Learning/GLOSSARY.md` is the subject speaking. The test: a term that
changes where a file goes or what it is named belongs in `CONTEXT.md`;
a term of the subject matter belongs in the workspace glossary. Consult
both, and `docs/adr/`, before classifying, naming or organising content.

Mint a term only from an ambiguity that actually bit: the Owner resolved a
parked item on the meaning of a word, or a live session showed Owner and
agent meaning different things by one word. With the Owner present, show
the drafted entry in that exchange — their yes on the wording is the
approval. Unattended, load the domain-modeling discipline and apply its
tests before writing, and surface every write in the run's report.

A module ADR records a standing rule the contract does not force, whose
reversal would strand records built on it. Numbered locally from 0001;
superseded by a new ADR, never edited. Register entries cite it from their
evidence field.

## Safety

Work here runs through a route. Anything no route or procedure covers
parks for the Owner: a parked item is a good outcome, an invented one is
not.

- Importer roots (`NTULearn` and any declared sibling) are read-only —
  curation copies out of them, leaving names and layout untouched.
- Registers change only through their procedures.
- Structure changes only through the structure doc — a directory it does
  not name is an Owner decision.

## Updating these instructions

This file and the four docs it names are pinned: their text is the
contract's, identical in every module, and the auditor flags a stale copy.
Propose a change by showing the Owner the exact new wording before
applying it. Module-specific knowledge lives in `CONTEXT.md`,
`docs/adr/` or the profile — never here.

Draft any change to a doc agents read — this file, the four docs,
`CONTEXT.md`, an ADR — with the writing-for-agents discipline before
showing or writing it.
