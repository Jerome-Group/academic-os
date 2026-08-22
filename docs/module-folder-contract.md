# The module folder contract

The normative folder and naming contract every module folder follows. A folder that disagrees
with an applicable rule here is wrong, and a rule that is not here is not a rule. One surface
outside a module folder is governed too, and it is the only one: the shared Textbook shelf at
`Modules/Textbooks`, which every module cuts its chapters from.

**Contract version: 4.** Increase it when a normative requirement, applicability rule or allowed
structure changes. Editorial clarification and repaired citations do not change it. Definition
schema versions advance independently.

Rules have stable IDs. **Deterministic** rules are decided without judgment; **judgment** rules
must expose their evidence for an agent or person to resolve. The folders live outside this
repository — [`docs/adr/0002`](adr/0002-the-contract-lives-here-and-the-coursework-does-not.md).
Y1S1 and Y1S2 are historical archives and change only through an explicitly approved migration.

**A date is a calendar day in the offering's timezone** — `Asia/Singapore` for an NTU offering —
written `YYYY-MM-DD` and carrying no zone marker. Every date this contract requires reads that way.
An instant is the other thing, and the Curation register's `timestamp` is the one this contract
asks for — [`docs/adr/0012`](adr/0012-a-date-is-a-calendar-day-and-a-stamp-is-cited-unread.md).

## Seeding a module

**MF-SEED-001 (judgment).** For a requested semester and module code:

1. Inspect existing local and Drive context.
2. Research current module details from supplied or NTULearn material, then official NTU sources.
3. Treat unsupported details as unknown.
4. Propose the Profile, Definition and context-derived structure with cited evidence.
5. Obtain confirmation.
6. Preview the complete seed plan; apply only on explicit instruction.

**MF-SEED-002 (deterministic).** Seed is additive. A conflict blocks all planned creation. A new
module is built in a uniquely marked staging folder, validated, then atomically renamed to its
module code so no partial final tree becomes visible. Additions to an existing folder are
journalled and idempotent; interruption is reported and resumed rather than hidden. Seed never
renames or removes existing material.

**MF-SEED-003 (deterministic).** Without reliable context, enable no context-derived assessment,
project, lab or resource category. Midterms and Finals remain universal.

## Universal structure

**MF-ROOT-001 (deterministic).** A module directory is a direct child of its configured semester
root and uses the uppercase module code alone. Resolve it only beneath the exact configured root;
reject root escapes, symlinks, duplicate targets, case variants and unresolved cloud placeholders
before inventory or writes.

**MF-UNIVERSAL-001 (deterministic).** Every module folder contains:

```text
MODULE_CODE/
├── 00 Module Admin/
│   ├── 00 Module Profile.md
│   ├── 10 Module Definition.yaml
│   ├── 20 Curation Register.jsonl
│   ├── 30 Task Register.yaml
│   ├── 40 Source Map.yaml
│   └── 50 Textbook Register.yaml
├── 10 Learning Materials/
│   ├── 10 Lecture Materials/
│   ├── 20 Textbook Chapters/
│   └── 30 Personal Notes/
├── 20 Tutorials/
├── 30 Assessments/
│   ├── 30 Midterms/
│   └── 40 Finals/
├── 40 Projects and Labs/
├── 70 Learning/
│   ├── 10 Lectures/
│   │   └── records/
│   ├── 20 Tutorials/
│   │   └── records/
│   ├── 30 Revision/
│   │   └── records/
│   ├── 40 Past Papers/
│   │   └── records/
│   ├── templates/
│   ├── GLOSSARY.md
│   ├── RESOURCES.md
│   └── REVISIT.md
├── 90 Resources/
│   └── 00 Unclassified/
├── .scratch/
├── NTULearn/
├── AGENTS.md
├── CLAUDE.md
├── CONTEXT.md
└── docs/
    ├── 00 Structure and Naming.md
    ├── 10 Curation Procedure.md
    ├── 20 Teaching Procedure.md
    ├── 30 Textbook Procedure.md
    └── adr/
```

**MF-ROOT-002 (deterministic).** Loose academic contents at module root are errors. An unknown root
directory requires a decision; it is neither an automatic contract failure nor a contract
proposal.

**MF-ROOT-003 (deterministic).** What the mount writes into a folder by itself is not module content,
and an inventory of a mounted folder omits it: a dot-named **file**, and the zero-byte `Icon\r` a
custom folder icon leaves behind. Finder writes both back into any directory it displays, so a rule
reaching them would fail on a folder nobody had done anything wrong to, and no deletion would settle
it. Only a file is ever one of these — `.scratch` is a dot-name MF-UNIVERSAL-001 requires, and an
`Icon\r` carrying bytes is content under a name Finder happens to use. The Drive API returns
neither, so this is the mounted reader's rule alone.

## Module controls

### Profile

**MF-PROFILE-001 (deterministic).** `00 Module Profile.md` uses this exact heading order:

```markdown
# MODULE_CODE — Module Title

## Offering
## Scope
## Teaching Structure
## Assessment Structure
## Source Authority
## Workspaces
## Known Gaps
```

Offering uses `Field | Value | Evidence`; Assessment Structure uses
`Component | Weight | Timing | Evidence`; Source Authority uses
`Rank | Source | Role | Governs | Evidence`; Workspaces uses
`Workspace | Purpose | Pointer`; Known Gaps uses `Gap | Consequence | Next evidence`. Scope and
Teaching Structure are concise prose or bullets.

**MF-PROFILE-002 (judgment).** The Profile contains confirmed human-facing facts and explicit
unknowns. It excludes executable rules, full inventories, per-file curation state, live task
progress, session history, build commands and durable architectural rationale. Where a fact lives
in a file some tool rewrites every run, the Profile cites the file rather than a value read out of
it: an Evidence cell names `NTULearn/Last synced.md`, because a day copied out of it is stale by
the next sync.

**MF-PROFILE-003 (deterministic).** Profile identity and offering agree with the Definition.

### Definition

**MF-DEFINITION-001 (deterministic).** `10 Module Definition.yaml` is the machine authority for
schema and contract versions, module identity, offering, applicable context-derived structure,
declared importer roots and their evidence. It contains module-relative paths only: no absolute
Drive paths, credentials, deadlines, prose workflows, inventories or learner progress.

The schema version 2 shape for contract version 4 is:

```yaml
schema_version: 2
contract_version: 4
module: {code: MH2100, title: Calculus III}
offering: {academic_year: 2026-2027, semester: 1, status: active}
structure:
  tutorials: {layout: grouped, groups: [CC0001, CC0002], evidence: [course-site]}
  assessments:
    quizzes: {enabled: true, evidence: [assessment-profile]}
    tests: {enabled: false}
    assignments: {enabled: true, evidence: [assessment-profile]}
  projects: {enabled: false}
  labs: {enabled: false}
  resource_categories:
    - {name: 10 Formula Sheets, evidence: [course-site]}
sources:
  ntulearn:
    - {role: primary, destination: NTULearn, evidence: [course-site]}
evidence:
  assessment-profile:
    source: <official URL or NTULearn reference>
    checked_at: 2026-08-11
  course-site:
    source: <official URL or NTULearn reference>
    checked_at: 2026-08-11
exceptions: []
```

Every evidence entry has a non-empty `source` and a `checked_at` date in `YYYY-MM-DD` form.
`exceptions` is present even when empty. Each exception records `rule`, `reason` and a non-empty
list of evidence keys. Importer-root declarations likewise carry a non-empty list of evidence keys.
An evidence `source` naming a mirror is a citation, and MF-IMPORTER-001 says what form it takes.

**MF-DEFINITION-002 (deterministic).** Enabled contextual structure has evidence. Explicit
`unknown` is valid; invented certainty is not. Contract-version lag is an upgrade-required error,
distinguished from folder drift.

### Agent and domain controls

**MF-AGENTS-001 (deterministic).** `AGENTS.md` is the module's router, and it is fully local: it
carries no git, GitHub, pull-request, generic coding-standard or repository workflow. Its sections
are these six, in this order: What this folder is; Start here; Routes; Domain language; Safety;
Updating these instructions.

Routes are these eight, each a bullet opening with its area in bold and pointing at the procedure
or file the work runs by:

```text
Curation  Teaching  Tutorials  Textbooks  Tasks  Assessments  Projects/Labs  Maintenance
```

Domain language points at `CONTEXT.md` for the module's organisational terms and `docs/adr/` for
its standing decisions, both read before content is classified, named or organised.

**MF-AGENTS-002 (deterministic).** `CLAUDE.md` contains exactly a `# Claude Code` heading followed
by `Read \`AGENTS.md\` completely before working in this module folder.` It never contains an
independent rule copy. Required AGENTS pointers resolve.

**MF-AGENTS-003 (judgment).** A change to a doc agents read here — `AGENTS.md`, the four procedure
files, `CONTEXT.md`, an ADR — is approved before it is applied, and the gate is who is present.
With the Owner in the session, the drafted wording is shown in the exchange that raised it, and
their yes on that exact wording is the approval. Unattended, a run writes `CONTEXT.md` and
`docs/adr/` directly only with the domain-modeling discipline loaded and its tests applied, and
surfaces every such write in its report; precedent is its only resolver, and an ambiguity without
precedent parks.

**MF-AGENTS-004 (deterministic).** `AGENTS.md`, the four `docs/` procedure files and
`70 Learning/templates/preferences.md` are pinned: each module's copy is byte-identical to this
repository's canonical seed-source template in `seed-templates/`, modulo `MODULE_CODE`
interpolation. Seeding writes them from those templates and audit diffs them back against the same
files, so a copy differing by one byte is a deviation, repaired by rewriting the copy rather than by
editing it. The preferences file is pinned because it amends at the seeded set: a preference the
Owner accepts changes every module's copy at once, and one true of a single module is a `CONTEXT.md`
entry instead, so no module has its own text to keep —
[`docs/adr/0015`](adr/0015-teaching-preferences-are-pinned-and-latex-is-not.md).

Module-specific content never enters a pinned file; it belongs in `CONTEXT.md`, `docs/adr/` or the
Profile.

**MF-CONTEXT-001 (deterministic).** `CONTEXT.md` is a glossary only, holding the module's
organisational terms — what its material is called, and how that changes where a file goes or what
it is named. Seed its module heading, purpose and `## Language`, inventing no terms. Add a term
only after an ambiguity has been resolved. A new term appends; an existing meaning is amended in
place as the deliberate point of the change, never as a side effect of other work. The file keeps
no superseded entry.

**MF-DOCS-001 (deterministic).** General documentation belongs in `docs/`, which holds the four
pinned procedure files and `docs/adr/`. Every module contains `docs/adr/`, even when it is empty.
An ADR records a standing rule this contract does not force, whose reversal would strand the
records built on it; a decision that touches one item once is a register line instead. ADRs are
numbered module-locally from `0001` and are append-only: an ADR is never edited, and a change of
mind is a new ADR superseding it. A per-item decision applying one cites it from its register
line's `evidence` field. Active tasks, deadlines and session journals are not current-state
authority.

**MF-ADMIN-001 (deterministic).** Module Admin has no subdirectories. Additional flat admin files
require a decision.

### Curation register

**MF-CURATION-001 (deterministic).** `20 Curation Register.jsonl` is empty at seed. Each later line
is one append-only curation-decision event recording schema version, stable source identity,
integration and role, source-relative path and checksum when available, decision, where the item's
content went, evidence, timestamp and any superseded event.

Version 1 uses `schema_version`, `source_id`, `integration`, `role`, `source_path`, optional
`checksum`, `decision`, conditional `destination`, `evidence`, `timestamp` and optional
`supersedes`. Its decisions are curated, source-only or requires-decision. Paths are relative, the
timestamp is ISO-compatible, and a curated event requires a destination.

Version 2 adds the fourth decision `rederived`: the item's content reached the module through
derived artifacts rather than through a copy, and the line names them in `derived` — a non-empty
sequence of module-relative paths — where a curated line names a `destination`. Both versions are
valid in one file. A version 1 line stays history exactly as it stands, so nothing migrates it and
a register mixing the two is conformant.

### Task register

**MF-TASKS-001 (deterministic).** `00 Module Admin/30 Task Register.yaml` mirrors one module's
Google Tasks list and carries the provenance that list cannot. It is current state rather than
history: each pull rewrites the rows Google owns.

```yaml
list_id: <exact Google Tasks list ID>
tasks:
  - task_id: <Google task ID; absent until the row is first pushed>
    title: Read the Week 03 notes
    do_date: 2026-08-21
    status: open | completed | cancelled
    notes: <mirrored Google notes>
    provenance:
      assessment: <assessment-category artifact>
      source: <NTULearn item or Curation-register pointer>
      milestone: <related Calendar milestone>
```

Seeding writes `tasks: []` and leaves the header's `list_id` out, because the module's list exists
only once provisioning creates or adopts it; provisioning then writes that list's exact ID, and a
register holding any row carries one. Every row states its `title` and its `status`; `task_id`,
`do_date`, `notes` and each `provenance` key are optional, and a row Google has forgotten reads
`cancelled` rather than leaving the register. A row carrying a date carries a date-only do-date,
and the schema reserves no room for a time of day — a deadline is a Calendar milestone owned
outside the folder.

## The Teaching workspace

**MF-LEARNING-001 (deterministic).** `70 Learning` is the Teaching workspace, and it holds four
activity areas — `10 Lectures`, `20 Tutorials`, `30 Revision`, `40 Past Papers` — each with its
own `records/`, beside `templates/`, `GLOSSARY.md`, `RESOURCES.md` and `REVISIT.md`. Seeding
creates every one of them for every module, whether or not that module will ever use them, and
writes this repository's LaTeX template set and teaching preferences into `templates/`.

`templates/` holds exactly these eight, each required by name, so a module keeps the set it was
seeded rather than holding an empty directory:

```text
graded-feedback.tex               reference-sheet.tex
lecture-walkthrough.tex           revision-notes.tex
preamble.tex                      tutorial-concepts-consolidation.tex
preferences.md                    tutorial-solution-writeup.tex
```

The seven `.tex` files are required by name alone and their contents are free: a module edits one
where the difference is functional, and the rendered page stays the same across modules.
`preferences.md` is the exception, pinned byte for byte under MF-AGENTS-004, because that argument
is about how a preference is amended rather than about a rendered page.

Enforcement stops at the activity area. What a folder inside one holds — a Lecture-unit, a
tutorial, a revision topic, a past paper — is the seeded Teaching procedure's business, and this
contract reads none of it.

**MF-LEARNING-002 (deterministic).** `00 Module Admin/40 Source Map.yaml` is the workspace's spine,
and it sits in Module Admin because it is machine-read module state rather than workspace content.
Its `units` mapping is keyed exactly as the module numbers its Lecture-units — a week or a lecture
in the module's own words, never a subdivision this system invented — and every unit carries
`topics`, `lectures`, `textbook` and `tutorials`, each of them a sequence, written out even when
empty — a unit with no textbook chapter says `textbook: []`, so a missing key is a malformed unit
rather than a quiet nothing. `topics` names ideas in the module's language; the other three hold
paths relative to the module folder, which is where the module's own material sits rather than the
workspace that studies it.

```yaml
units:
  Week 03:
    topics: [Partial derivatives, Chain rule]
    lectures:
      - 10 Learning Materials/10 Lecture Materials/MH2100_Lecture_03A_Partial_Derivatives.pdf
    textbook:
      - 10 Learning Materials/20 Textbook Chapters/MH2100_Stewart_Chapter_14.pdf
    tutorials:
      - 20 Tutorials/MH2100_Tutorial_03_Questions.pdf
```

Seeding writes an empty `units`, which grows as the module's material lands. A folder in
`10 Lectures` is named for a key here, and a Learning record's `unit` is one of them, so which files
a unit means is a lookup rather than a judgment.

## The Textbook library

This section is the contract's one reach outside a module folder. MF-TEXTBOOK-001 and
MF-TEXTBOOK-002 govern the shared Textbook shelf; MF-TEXTBOOK-003 and MF-TEXTBOOK-004 govern what a
module folder holds because of it. A module audit reads a module's own two and never the shelf —
one shelf serves every module, so it is checked where it is read rather than once per module that
reads it.

**MF-TEXTBOOK-001 (deterministic).** The Textbook shelf sits beside the semester roots at
`Modules/Textbooks`, configured like they are. It is the sole source every module cuts chapters
from, and whole books arrive on it by the Owner's hand alone. A book is named
`<Title> <N>e <Author surnames, comma-separated>.pdf` — the edition token present only when the
book has one, `Solutions` trailing a solutions manual — and sits directly on the shelf. `Archive/`
holds retired books and is not indexed; nor is anything else inside a folder on the shelf.

```text
Discrete Mathematics and Its Applications 8e Rosen.pdf
Introduction to Algorithms 4e Cormen, Leiserson, Rivest, Stein.pdf
Analysis I Tao.pdf
Linear Algebra Done Right 4e Axler Solutions.pdf
```

**MF-TEXTBOOK-002 (deterministic).** `00 Index.yaml` on the shelf catalogues it, one entry per book
under its **Book key** — a YAML mapping key, so uniqueness is structural.

```yaml
books:
  Rosen:
    file: Discrete Mathematics and Its Applications 8e Rosen.pdf
    title: Discrete Mathematics and Its Applications
    edition: 8e
    authors: [Rosen]
    division: Chapter
    sha256: <sha-256 of the PDF bytes>
```

The index owns every book-level fact and nothing below it repeats one. `edition` is absent when the
book has none, and `division` is the book's own word for how it divides itself — Chapter, Lecture,
Part — which no filename carries. A key defaults to the first author's surname and is qualified
where two books would collide (`Isaacs_FGT`, `Tao_I`, `Axler_Solutions`); it is **immutable once any
chapter filename cites it**. Entries are appended, and renaming or removing one is the Owner's.

**MF-TEXTBOOK-003 (deterministic).** `00 Module Admin/50 Textbook Register.yaml` records the
chapters this module cut, one entry per cut. Seeding writes `extractions: []`.

```yaml
extractions:
  - book: Rosen              # the key, into the Shelf index
    number: 3                # as the book prints it; roman recorded verbatim
    title: Algorithms        # the full table-of-contents title
    pages: [187, 244]        # absolute PDF pages, inclusive
    file: MODULE_CODE_Rosen_Chapter_03_Algorithms.pdf
    source_sha256: <the book's checksum at cut time>
```

An entry carries those six keys and no others: every book-level fact stays in the Shelf index the
entry cites. `number` is the number the book prints, so a roman numeral stays roman and an appendix
keeps its letter. `pages` is an inclusive first-and-last range of absolute PDF pages, `file` is the
MF-TEXTBOOK-004 name of the chapter that came out, and `source_sha256` against the index's current
checksum is what makes a chapter cut from a superseded copy of the book findable.

**MF-TEXTBOOK-004 (deterministic).** Cut chapters land in `10 Learning Materials/20 Textbook
Chapters/`, and every file there is one. Their names instantiate MF-NAMING-002 exactly, and so
stand in place of it there — a Book key the Owner qualified on collision spells capitals the
general rule's Title Case would refuse:

```text
MODULE_CODE_Rosen_Chapter_03_Algorithms.pdf
MODULE_CODE_Tao_I_Chapter_05_The_Real_Numbers.pdf
MODULE_CODE_Rosen_Appendix_A_Axioms_For_The_Real_Numbers.pdf
```

The Division word comes from the index, in full. Numbers are two-digit zero-padded arabic even
where the book prints roman, and appendix letters stay as printed. Titles are the book's own
table-of-contents titles, Title_Cased, and may be shortened here because the register keeps the
full one. The edition stays out of the filename — the key resolves it.

## Context-derived structure

### Tutorials

**MF-TUTORIALS-001 (deterministic).** Definition declares `flat` or `grouped`. Flat Tutorials have
files directly inside `20 Tutorials`; grouped Tutorials may use source-derived subdirectory names
that are not forced into `Tutorial NN` or Title Case. A grouped declaration records the exact,
unique names in `groups` and cites evidence for them; a flat declaration has no `groups`. `groups`
covers every session the course's own schedule gives tutorial material, across the whole offering
rather than the part published so far, so a sheet arriving mid-semester lands in a group that is
already there. A session that schedule runs without material of its own — a consultation, a
showcase, a presentation, a week it marks as having no tutorial — gets no group, because a group is
where curated sheets live and an empty one says a sheet is missing. The numbering keeps the gaps
those sessions leave. Curated files in either layout still follow the file-naming rules.

### Assessments

**MF-ASSESSMENTS-001 (deterministic).** Assessments use these exact categories when applicable:

```text
10 Quizzes
20 Tests
30 Midterms
40 Finals
50 Assignments
```

Midterms and Finals are universal. Definition enables Quizzes, Tests and Assignments. Uncommon
graded formats such as posters, presentations, panel discussions and vivas belong in Assignments.
Assessment-category contents are flat; filenames distinguish occurrences and artifacts.

### Projects and Labs

**MF-WORKSPACES-001 (deterministic).** Definition enables Projects or Labs. Each enabled workspace
uses its exact five children; contents beneath them may nest:

```text
40 Projects and Labs/
├── 10 Projects/
│   ├── 10 Briefs/
│   ├── 20 References/
│   ├── 30 Working/
│   ├── 40 Data/
│   └── 50 Submissions/
└── 20 Labs/
    ├── 10 Briefs/
    ├── 20 References/
    ├── 30 Working/
    ├── 40 Data/
    └── 50 Submissions/
```

### Open interiors

**MF-OPEN-001 (deterministic).** Learning Materials requires its three universal children and
allows nesting beneath them. Resources requires `00 Unclassified` and allows Definition-declared
additional categories, each declared by exact `name` with evidence. Projects/Labs workspace
children allow nesting. The interiors of `docs`, `.scratch` and every declared importer root are
outside structural enforcement, with two exceptions: `docs` holds the pinned procedure files and
`adr/` that MF-UNIVERSAL-001 names, and `.scratch` may not contain a LaTeX `build/`. `70 Learning`
is enforced as deep as MF-LEARNING-001 reaches and open below it.

## Importer roots and curation

**MF-IMPORTER-001 (deterministic).** `NTULearn` is universal. Definition may declare additional
exact automation-owned roots such as `NTULearn_Tutorial`. Their internal names are importer-owned
and exempt from folder and file naming rules. An undeclared `NTULearn_*` root requires a decision.

A control cites a mirror by one of three forms, and never by a path into its interior: an importer
**landmark**, which is `Course.md`, `Last synced.md`, `Announcements/` or a root itself; the
document's **file name**, exactly as the mirror writes it; or the document **named in words**, which
is what the importer's own generic names such as `ultraDocumentBody.md` leave no alternative to. A
path into the interior records the item's position, and a position moves whenever NTULearn inserts
above it. This binds the Profile's Evidence cells, the Definition's `evidence.<key>.source` and a
Task row's `provenance.source`. The Curation register is untouched: its `source_path` records where
the walk saw an item, which is an observation rather than a pointer —
[`docs/adr/0014`](adr/0014-evidence-cites-ntulearn-and-never-a-path-into-it.md).

**MF-CURATION-002 (judgment).** Curation preserves an importer source and creates a renamed copy in
its canonical destination. Every source item becomes one of the decisions its schema version
carries. Ambiguous placement is shown with evidence and left uncopied until resolved. A source
update never silently overwrites a curated copy since annotated, graded or otherwise modified; a
disappeared source does not delete its curated copy and is reported as a discrepancy.

**MF-CURATION-003 (judgment).** Where a module issues material both clean and annotated, the
annotated copy is a second curated item, sharing the clean copy's number and topic and
distinguished by the `Annotated` qualifier. The two are different artifacts with different uses, so
both lines stand and neither supersedes the other. The clean copy carries the number and the topic,
so an annotated copy arriving before one is an ambiguity to park.

**MF-CURATION-004 (judgment).** Where the same material stands at two live source paths — a site
reissuing without removing the earlier copy — the newer issue carries the curated name and the
earlier is source-only. This is not the source update MF-CURATION-002 governs: there one path's
bytes changed against a placed copy, and here two paths stand at once and build one curated name,
which the newer issue takes because it is what the course now means. The name is the material's
rather than a release's, so it holds across a reissue and a source's revision date belongs to the
line's evidence. Two sources holding different material are two items, and two sources with nothing
to say which is newer are an ambiguity to park.

## Naming

**MF-NAMING-001 (deterministic).** Fixed paths use their exact spelling and case. Other governed
folders use Title Case with spaces and sparse numeric prefixes where specified. Grouped Tutorial
names and declared importer roots are the explicit exceptions.

**MF-NAMING-002 (deterministic).** A file deliberately placed in Learning Materials, Tutorials,
Assessments, Projects/Labs or Resources is curated. Its name begins with the uppercase module code,
then Title Case underscore-separated tokens. Sequences use two digits, dates `YYYY-MM-DD`, years
four digits and extensions lowercase. A sequence number is read from the source's own naming — the
item's title, or the attachment's own filename — so an importer mirror's `NN ` prefix stays that
importer's ordering, and a source numbering itself nowhere is an ambiguity to park. Files inside
importer roots, `.scratch`, `build`, `docs`, `70 Learning`, plus root controls, are exempt, as is
`10 Learning Materials/20 Textbook Chapters`, whose names MF-TEXTBOOK-004 fixes exactly.

**MF-NAMING-003 (judgment).** Useful qualifiers include `Questions`, `Solutions`, `Draft_01`,
`Annotated` and `Graded`. A completed file has no `Final` version suffix; `Final` names the final
examination. Avoid `(1)`, `copy` and `final-final`. On collision, compare duplicates and otherwise
add a meaningful year, sequence, source or version.

```text
MH2100_Lecture_03_Graph_Theory.pdf
MH2100_Tutorial_01_Solutions.pdf
MH2100_Midterm_2025_Graded.pdf
MH2100_Assignment_01_Draft_02.docx
MH2100_Quiz_02_2026-09-14_Graded.pdf
```

## LaTeX builds

**MF-LATEX-001 (deterministic).** Keep `.scratch` at module root. Do not seed a module-root
`build/` or place one inside `.scratch`. Create `build/` beside each compilation workspace only
when LaTeX appears. Simple files sharing a directory may share its build directory; independent
projects use independent builds. Put user-facing PDFs beside their source or in `50 Submissions`.

## Auditing and lifecycle

**MF-AUDIT-001 (deterministic).** Audit evaluates rules, not exact-tree equality. A rule result is
`pass`, `fail`, `warning`, `manual-review`, `requires-decision` or `not-applicable`; every non-pass
includes evidence and applicability reasoning. Missing/unavailable metadata is never equality.

**MF-AUDIT-002 (deterministic).** Current mismatch is deviation. Drift is changed conformance
between complete observations. Observations contain paths and metadata, never file contents, and
are append-only outside git until explicit compaction is approved.

**MF-AUDIT-003 (deterministic).** Only the configured active-semester monitoring cohort is audited
continuously. Past and future modules are audited or changed only after a user request or an agent
proposal the user accepts. Historical migration findings are enabled explicitly and never mutate
their target.

**MF-TRANSITION-001 (judgment).** A folder whose Definition lags the current contract version
reaches it by **transition**, one module at a time. An agent diffs the current structure against
what the folder holds and drafts where each module-local item the pinned structure cannot keep is
re-homed — organisational terms to `CONTEXT.md`, standing rules to `docs/adr/`, module facts to the
Profile — then shows the Owner the diff and the plan together; their yes on that module is the
approval to apply it. Transition writes the control files this repository authors and moves
documents; it reads academic contents and leaves them where they are, so it binds no recovery
snapshot and no Drive-ID inventory — that evidence is repair's, proportionate to relocating real
coursework. Every write follows `docs/agents/safe-drive-testing.md`. The Definition's
`contract_version` moves last, once the structure it declares is there.

## Deferred work

Two remainders are future work. **Weekly whole-session study orchestration** — planning a week of
study across a module's units and driving the sessions that carry it out — is not what the daily
curation procedure delivers; that procedure places the day's arrivals and stops there. **Autonomous
module-specific instruction evolution** — a module rewriting the procedures it runs on from what it
learns — stays outside every agent's authority; a pinned file changes in this repository and
reaches modules by seeding. The contract defines the interfaces both must respect; it does not
claim they exist.
