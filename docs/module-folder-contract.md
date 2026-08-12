# The module folder contract

The normative folder and naming contract every module folder follows. A folder that disagrees
with an applicable rule here is wrong, and a rule that is not here is not a rule.

**Contract version: 3.** Increase it when a normative requirement, applicability rule or allowed
structure changes. Editorial clarification and repaired citations do not change it. Definition
schema versions advance independently.

Rules have stable IDs. **Deterministic** rules are decided without judgment; **judgment** rules
must expose their evidence for an agent or person to resolve. The folders live outside this
repository — [`docs/adr/0002`](adr/0002-the-contract-lives-here-and-the-coursework-does-not.md).
Y1S1 and Y1S2 are historical archives and change only through an explicitly approved migration.

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
│   └── 20 Curation Register.jsonl
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
├── 90 Resources/
│   └── 00 Unclassified/
├── .scratch/
├── NTULearn/
├── AGENTS.md
├── CLAUDE.md
├── CONTEXT.md
└── docs/
    └── adr/
```

**MF-ROOT-002 (deterministic).** Loose academic contents at module root are errors. An unknown root
directory requires a decision; it is neither an automatic contract failure nor a contract
proposal.

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
progress, session history, build commands and durable architectural rationale.

**MF-PROFILE-003 (deterministic).** Profile identity and offering agree with the Definition.

### Definition

**MF-DEFINITION-001 (deterministic).** `10 Module Definition.yaml` is the machine authority for
schema and contract versions, module identity, offering, applicable context-derived structure,
declared importer roots and their evidence. It contains module-relative paths only: no absolute
Drive paths, credentials, deadlines, prose workflows, inventories or learner progress.

The schema version 2 shape for contract version 3 is:

```yaml
schema_version: 2
contract_version: 3
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
list of evidence keys. Importer-root declarations likewise carry a non-empty list of evidence
keys.

**MF-DEFINITION-002 (deterministic).** Enabled contextual structure has evidence. Explicit
`unknown` is valid; invented certainty is not. Contract-version lag is an upgrade-required error,
distinguished from folder drift.

### Agent and domain controls

**MF-AGENTS-001 (deterministic).** Seed `AGENTS.md` once as a concise, fully local router with
these sections: What this folder is; Start here; Routes; Domain language; Safety; Updating these
instructions. Routes cover Learning, Tutorials, Curation, Assessments, Projects/Labs and
Maintenance through strong context pointers. Domain language points to `CONTEXT.md` for the
glossary and `docs/adr/` for decisions before content is classified, named or organised. It
contains no git, GitHub, pull-request, generic coding-standard or repository workflow.

**MF-AGENTS-002 (deterministic).** `CLAUDE.md` contains exactly a `# Claude Code` heading followed
by `Read \`AGENTS.md\` completely before working in this module folder.` It never contains an
independent rule copy. Required AGENTS pointers resolve.

**MF-AGENTS-003 (judgment).** Changes to AGENTS are shown and approved before application.

**MF-CONTEXT-001 (deterministic).** `CONTEXT.md` is a glossary only. Seed its module heading,
purpose and `## Language`, inventing no terms. Add terms only after ambiguity is resolved.

**MF-DOCS-001 (deterministic).** General documentation belongs in `docs/`. Every module contains
`docs/adr/`, even when it is empty; add an ADR only when a hard-to-reverse, surprising trade-off
has actually been decided. Active tasks, deadlines and session journals are not current-state
authority.

**MF-ADMIN-001 (deterministic).** Module Admin has no subdirectories. Additional flat admin files
require a decision.

### Curation register

**MF-CURATION-001 (deterministic).** `20 Curation Register.jsonl` is empty at seed. Each later line
is one append-only curation-decision event recording schema version, stable source identity,
integration and role, source-relative path and checksum when available, decision, destination when
curated, evidence, timestamp and any superseded event. Its decisions are curated, source-only or
requires-decision.

Version 1 uses `schema_version`, `source_id`, `integration`, `role`, `source_path`, optional
`checksum`, `decision`, conditional `destination`, `evidence`, `timestamp` and optional
`supersedes`. Paths are relative, the timestamp is ISO-compatible, and a curated event requires a
destination.

## Context-derived structure

### Tutorials

**MF-TUTORIALS-001 (deterministic).** Definition declares `flat` or `grouped`. Flat Tutorials have
files directly inside `20 Tutorials`; grouped Tutorials may use source-derived subdirectory names
that are not forced into `Tutorial NN` or Title Case. A grouped declaration records the exact,
unique names in `groups` and cites evidence for them; a flat declaration has no `groups`. Curated
files in either layout still follow the file-naming rules.

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
children allow nesting. The interiors of
`70 Learning`, `docs`, `.scratch` and every declared importer root are outside structural
enforcement, except that `.scratch` may not contain a LaTeX `build/`.

## Importer roots and curation

**MF-IMPORTER-001 (deterministic).** `NTULearn` is universal. Definition may declare additional
exact automation-owned roots such as `NTULearn_Tutorial`. Their internal names are importer-owned
and exempt from folder and file naming rules. An undeclared `NTULearn_*` root requires a decision.

**MF-CURATION-002 (judgment).** Curation preserves an importer source and creates a renamed copy in
its canonical destination. Every source item becomes curated, source-only or requires-decision.
Ambiguous placement is shown with evidence and left uncopied until resolved. A source update never
silently overwrites an annotated, graded or otherwise modified curated copy; a disappeared source
does not delete its curated copy and is reported as a discrepancy.

## Naming

**MF-NAMING-001 (deterministic).** Fixed paths use their exact spelling and case. Other governed
folders use Title Case with spaces and sparse numeric prefixes where specified. Grouped Tutorial
names and declared importer roots are the explicit exceptions.

**MF-NAMING-002 (deterministic).** A file deliberately placed in Learning Materials, Tutorials,
Assessments, Projects/Labs or Resources is curated. Its name begins with the uppercase module code,
then Title Case underscore-separated tokens. Sequences use two digits, dates `YYYY-MM-DD`, years
four digits and extensions lowercase. Files inside importer roots, `.scratch`, `build`, `docs`,
`70 Learning`, plus root controls, are exempt.

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

## Deferred work

Teaching-workspace internals, automated curation, weekly LLM orchestration and autonomous
module-specific instruction evolution remain future work. The contract defines the interfaces
they must respect; it does not claim they exist.
