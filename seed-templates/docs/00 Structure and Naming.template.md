# Structure and Naming

Where a file goes in the MODULE_CODE folder, what it is called, and what may move once it is
there. Every route in `AGENTS.md` presumes these rules; work that cannot satisfy one parks.

## The universal tree

Every module folder holds exactly this, whatever the module is:

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

| Directory | What it is for |
| --- | --- |
| `00 Module Admin/` | The module's controls: the profile, the definition, and the registers automation reads. Flat — it has no subdirectories. |
| `10 Learning Materials/` | Curated teaching material — what the module issued, the chapters cut from the shelf, and the Owner's own notes. |
| `20 Tutorials/` | Curated tutorial sheets as the module issued them. Working through one happens in the Teaching workspace. |
| `30 Assessments/` | Graded-work artifacts, one flat directory per assessment category. |
| `40 Projects and Labs/` | The project and lab workspaces this module has. |
| `70 Learning/` | The Teaching workspace: one directory per activity area, each holding its `records/` beside one folder per unit, tutorial, topic or paper — `docs/20 Teaching Procedure.md` § The four activity areas says which of the four an area takes. |
| `90 Resources/` | Reference material that is not teaching material; `00 Unclassified/` holds what has no declared category. |
| `.scratch/` | Working files nothing else reads. Nothing durable lives here, and a LaTeX `build/` never does. |
| `NTULearn/` | The importer's mirror — read-only, and the source curation copies out of. |
| `docs/` | The four pinned procedure docs and this module's own ADRs. |

Module root holds the three control files and nothing loose beside them.

## What the Module Definition adds

`00 Module Admin/10 Module Definition.yaml` is the authority for everything the tree above leaves
open. Read it; the material in front of you is never the evidence for a category.

- **Tutorial layout** — `flat` puts sheets directly in `20 Tutorials/`; `grouped` puts them in the
  exact group directories the Definition names.
- **Assessment categories** — `30 Midterms/` and `40 Finals/` are universal; the Definition enables
  `10 Quizzes`, `20 Tests` and `50 Assignments`. Uncommon graded formats — posters, presentations,
  panel discussions, vivas — belong in `50 Assignments`.
- **Project and lab workspaces** — the Definition enables `10 Projects/`, `20 Labs/` or both inside
  `40 Projects and Labs/`. Each enabled workspace has exactly `10 Briefs/`, `20 References/`,
  `30 Working/`, `40 Data/` and `50 Submissions/`; contents beneath them nest freely.
- **Resource categories** — `90 Resources/` takes the additional categories the Definition names,
  each by its exact name.
- **Importer roots** — `NTULearn` is universal; any sibling root is declared there too.

A category the Definition has not enabled does not exist in this module. Enabling one is an Owner
decision, recorded in the Definition with its evidence.

## Naming a file

A file deliberately placed in Learning Materials, Tutorials, Assessments, Projects and Labs, or
Resources is **curated**, and its name is built rather than carried over:

- The module code first, then Title Case tokens separated by underscores.
- Sequence numbers are two digits, read from the source's own numbering — never from a file's
  position in a listing, and never from an importer directory's `NN ` prefix.
- Dates are `YYYY-MM-DD`, years are four digits, extensions are lowercase.
- Qualifiers that earn their place: `Questions`, `Solutions`, `Annotated`, `Graded`, `Draft_01`.
  `Final` names the final examination, so a finished file carries no version suffix.
- On a name collision, compare the two files first, then separate them by year, sequence, source
  or version.

```text
MODULE_CODE_Lecture_03_Graph_Theory.pdf
MODULE_CODE_Tutorial_01_Solutions.pdf
MODULE_CODE_Midterm_2025_Graded.pdf
MODULE_CODE_Assignment_01_Draft_02.docx
MODULE_CODE_Quiz_02_2026-09-14_Graded.pdf
```

Exempt from all of it: everything inside an importer root, `.scratch/`, a `build/`, `docs/` and
`70 Learning/`, plus the three root control files. Importer names stay the importer's, and the
Teaching workspace names by its own procedure.

Directories use the exact spelling and case written above — in the tree, and in what the Definition
adds. Declared tutorial group names and declared importer roots are the only directory names that
come from a source instead of from this doc.

## Placing a file

Work this list in order and stop at the first line that answers.

1. **It is already inside an importer root.** Leave it there; curation copies out.
2. **A route owns it.** Curation, teaching and textbook outputs are placed by their procedures in
   `docs/` — follow the procedure rather than placing by hand.
3. **The tree names its home.** Lecture material to `10 Learning Materials/10 Lecture Materials/`,
   a chapter cut from the shelf to `20 Textbook Chapters/`, the Owner's own writing to
   `30 Personal Notes/`, an issued tutorial sheet to `20 Tutorials/`, a graded-work artifact to its
   assessment category, project or lab material to that workspace's five children, reference
   material to its declared category or to `00 Unclassified/`.
4. **A register line already placed something like it.** That precedent decides, and the new line
   cites it.
5. **Anything else parks.** Precedents that disagree park too: settling them is a decision, and a
   decision is the Owner's.

## Moving and renaming

- **Importer roots never change.** Nothing inside one is renamed, moved or removed, and nothing new
  is written into one.
- **Registers change only through their procedures.** The Curation register is append-only history:
  a later event supersedes an earlier one and both lines stay. The Task register is current state,
  refreshed by its own pull.
- **Records and ADRs supersede rather than disappear.** A Learning record is replaced by a new
  record naming the one it supersedes; a module ADR is replaced by a new ADR. Both stay readable
  where they are.
- **A placed copy that has diverged holds its ground.** An annotated, graded or otherwise edited
  copy stops an incoming update: park it.
- **A misnamed or misplaced curated file is a correction, not routine work.** It contradicts what a
  register line recorded, so show the Owner the rename or move and the line it touches before
  applying it.

## What always parks

To park is to leave the file exactly as it is and surface it — in the session when the Owner is
present, in the run's report when not — naming the item and what was ambiguous about it.

- Material no route or procedure covers.
- A placement with no precedent, or with precedents that disagree.
- A directory at module root this doc does not name.
- Material that wants a category the Module Definition has not enabled.
- An arriving update whose placed copy has diverged from what was placed.
- A name the rules above cannot build — no source numbering to read, no module code to lead with.
- Any operation that would write inside an importer root.
