# The module folder contract

The folder and naming contract every module folder follows. It is normative: a folder that
disagrees with this file is wrong, and a rule that is not here is not a rule.

The folders themselves live outside this repository — see
[`docs/adr/0002`](adr/0002-the-contract-lives-here-and-the-coursework-does-not.md) for why the
contract can describe something it must never contain. Existing Y1S1 and Y1S2 modules are
historical archives; change them only when migration is explicitly requested.

## Seeding a module

For a requested semester and module code:

1. Inspect existing local and Drive context.
2. Research the latest official module details. Prefer current supplied documents or NTULearn,
   then official NTU sources. Treat unsupported details as unknown.
3. Propose the researched secondary structure and cite its sources.
4. Obtain confirmation.
5. Create the module folder and `00 Module Admin/00 Module Profile.md`.

When reliable context is absent, seed only `30 Midterms` and `40 Finals` under assessments.
Research may add quizzes, tests, assignments, projects, labs, and resource categories.

## Universal structure

```text
MODULE_CODE/
├── 00 Module Admin/
│   └── 00 Module Profile.md
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
├── CONTEXT.md
└── docs/
```

Use the module code alone for the module directory. Record its title and semester in the profile.

## Context-derived structure

Assessments use these canonical names when applicable:

```text
10 Quizzes
20 Tests
30 Midterms
40 Finals
50 Assignments
```

Place uncommon graded formats such as posters, presentations, panel discussions, and vivas under
`50 Assignments`. Keep assessment-category contents flat; encode distinguishing information in
filenames.

When applicable, use:

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

Create `10 Projects` or `20 Labs` only when context supports it. Keep `20 Tutorials` empty at seed
time and later store clearly named files directly within it. Keep Module Admin flat. Use
`90 Resources/00 Unclassified` as the intentional catch-all; add other resource categories only
when useful.

`70 Learning` reserves a home for the future personal teaching workflow. Its internal contract is
deferred. `CONTEXT.md` is the domain glossary; general documentation belongs in `docs/`. Their
internal content is deferred.

## Naming

- Folders: Title Case with spaces and sparse numeric prefixes where specified.
- Curated files: uppercase module code followed by Title Case tokens separated by underscores.
- Sequences: two digits. Dates: `YYYY-MM-DD`. Years: four digits. Extensions: lowercase.
- Useful qualifiers: `Questions`, `Solutions`, `Draft_01`, `Annotated`, and `Graded`.
- A completed file has no `Final` version suffix; reserve `Final` for the final examination.
- Avoid `(1)`, `copy`, and `final-final`. On collision, compare duplicates and otherwise add a
  meaningful year, sequence, source, or version.

Examples:

```text
MH2100_Lecture_03_Graph_Theory.pdf
MH2100_Tutorial_01_Questions.pdf
MH2100_Tutorial_01_Solutions.pdf
MH2100_Midterm_2025_Graded.pdf
MH2100_Assignment_01_Draft_02.docx
MH2100_Quiz_02_2026-09-14_Graded.pdf
```

Keep conventional control names exact: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `docs`, `.scratch`,
and `NTULearn`. Do not rename automation-managed files inside `NTULearn`; curated copies placed
elsewhere follow the naming contract.

## LaTeX builds

Keep `.scratch` at module root. Do not seed one module-root `build/` or place builds inside
`.scratch`.

Create `build/` beside each LaTeX compilation workspace only when LaTeX appears. Simple files
sharing a directory may share its build directory; independent projects use independent builds.
Copy user-facing PDFs beside their source or into `50 Submissions`.

## Deferred decisions

Future work will define `AGENTS.md` and `CLAUDE.md` for generated module repositories, the
teaching workspace internals, domain-document contents, and automation implementation.
