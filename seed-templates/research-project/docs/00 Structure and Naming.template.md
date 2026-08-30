# Structure and Naming

Where an artifact goes in the {{PROJECT_NAME}} folder, what it is called, and what may move once
it is there. Every route in `AGENTS.md` presumes these rules; work that cannot satisfy one parks.

## The universal tree

```text
{{PROJECT_NAME}}/
├── 00 Project Admin/
│   ├── 00 Project Profile.md
│   ├── 10 Project Definition.yaml
│   ├── 20 Source Register.yaml
│   ├── 30 Task Register.yaml
│   ├── 40 Research Map.yaml
│   ├── 50 Deliverable Register.yaml
│   └── 60 Contribution and AI Use.md
├── 10 Source Materials/
│   ├── 10 Programme and Project/
│   ├── 20 Core Sources/
│   ├── 30 Reference Sources/
│   └── references.bib
├── 20 Supervisor Meetings/
├── 30 Deliverables/
├── 70 Research/
│   ├── 10 Reading/
│   ├── 20 Mathematics/
│   ├── 30 Experiments/
│   ├── templates/
│   ├── GLOSSARY.md
│   ├── QUESTIONS.md
│   └── CLAIMS.md
├── 90 Resources/
│   └── 00 Unclassified/
├── .scratch/
├── AGENTS.md
├── CLAUDE.md
├── CONTEXT.md
└── docs/
    ├── 00 Structure and Naming.md
    ├── 10 Sources and Provenance.md
    ├── 20 Research Procedure.md
    ├── 30 Deliverables Procedure.md
    └── adr/
```

| Directory | What it holds |
| --- | --- |
| `00 Project Admin/` | Flat project controls and registers; no research prose |
| `10 Source Materials/` | Programme/project authority, core literature, reference literature and bibliography |
| `20 Supervisor Meetings/` | Owner-confirmed meeting notes, one per meeting |
| `30 Deliverables/` | Programme-profile outputs, feedback and submission evidence |
| `70 Research/` | Owner-authored reading, mathematics and reproducible experiments |
| `90 Resources/` | Useful aids that do not establish a Claim |
| `.scratch/` | Disposable working files that no durable artifact reads |
| `docs/` | Four pinned procedures and project-local ADRs |

Project root holds the three agent controls and nothing loose beside them.

A dot-named file or zero-byte `Icon\r` written by the mount is not project content. Leave it
exactly where it is. Only a file qualifies: `.scratch/` is required, and an `Icon\r` with bytes is
content.

## What the Project Definition adds

Read `00 Project Admin/10 Project Definition.yaml`. `profile: generic` adds nothing.
`profile: ureca` adds:

```text
30 Deliverables/
├── 10 Abstract/
├── 20 Poster/
├── 30 Paper/
└── 40 Reflection/
90 Resources/
├── 10 Preparation Archive/
└── 20 Research Aids/
```

The declared profile is the sole authority for these directories. A folder found on disk is not
evidence for enabling one. No profile creates an NTULearn root.

## Placing an artifact

Work this list in order and stop at the first line that answers.

1. **A route owns it.** Sources, meetings, Research and Deliverables follow their numbered
   procedures.
2. **It is official programme or project authority.** Place it in
   `10 Source Materials/10 Programme and Project/` and register it.
3. **The current work relies on it as evidence.** Place it in `20 Core Sources/` and register it.
4. **It is background not yet relied upon.** Place it in `30 Reference Sources/` and register it.
5. **It is an aid rather than evidence.** Place it in a declared Resource category or
   `90 Resources/00 Unclassified/`.
6. **It is disposable.** Place it in `.scratch/`.
7. **Anything else parks.** Leave it untouched and name the ambiguity for the Owner.

Agent-generated explanations, orientation notes and candidate prose are aids or scratch. They do
not enter Source Materials. Owner-authored reading notes, proof work and computations enter
Research after the procedure's adoption gate.

## Naming

Fixed directories and controls use the exact spelling and case in the tree.

- Preserve a stable publisher or programme filename for a source. Otherwise lead with its
  Source-register ID.
- Name a meeting `YYYY-MM-DD Topic.md`.
- Name a reading note with its Source-register ID.
- Name related mathematics and experiment artifacts with the Research-map thread key followed by a
  short human title.
- Use `_Draft_01`, `_Draft_02` and so on for versions. A completed artifact has no `Final` suffix.
- Follow a programme-mandated submission name and record its authority in the Deliverable register.

On collision, compare the artifacts first. If both belong, distinguish them by date, Source ID or
draft number. Source-register IDs, BibTeX keys and Research-map keys remain stable when a display
filename changes.

Everything in `.scratch/`, a LaTeX `build/`, and the four pinned procedure files is exempt from
content naming.

## Moving and renaming

- Registers change through their routes. Source IDs, thread keys and deliverable keys remain
  stable.
- A source moving between Reference and Core keeps its ID; update the register's role and path.
- A meeting note becomes durable only after the Owner confirms it. A correction amends the note
  visibly rather than erasing attributed guidance.
- A submitted or supervisor-reviewed Deliverable holds its ground. A new draft is a new version.
- A project ADR is superseded by a new ADR. It is never deleted.
- A misplaced durable artifact is a correction: show the Owner the proposed move and every pointer
  it changes before applying it.

## LaTeX builds

Create `build/` beside a LaTeX workspace only when compilation begins. User-facing PDFs sit beside
their source or inside the matching Deliverable workspace. Keep auxiliary output in `build/` and
leave `.scratch/` free of build directories.

## Parking

Parking leaves the artifact exactly where it is and surfaces the unresolved choice. Park an
unsupported category, an unregistered evidence source, conflicting source authority, an unknown
root directory, a move that would break a pointer, or any work no route covers.
