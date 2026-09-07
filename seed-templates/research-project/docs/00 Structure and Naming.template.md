# Structure and Naming

## Workspace tree

```text
{{PROJECT_NAME}}/
├── 00 Project Admin/
├── 10 Source Materials/
│   ├── 10 Programme and Project/
│   ├── 20 Core Sources/
│   └── references.bib
├── 20 Supervisor Meetings/
│   └── YYYY-MM-DD Topic/
│       ├── Meeting.md
│       ├── Sources/
│       ├── 10 Learning/
│       │   ├── records/
│       │   └── NN Unit/
│       └── 20 Exercises/
│           ├── records/
│           └── NN Exercise Set/
├── 30 Deliverables/
├── 60 Templates/
├── 70 Research/
│   ├── 10 Concepts/
│   ├── 20 Research Notes/
│   ├── records/
│   ├── GLOSSARY.md
│   ├── QUESTIONS.md
│   └── CLAIMS.md
├── 90 Resources/
├── .scratch/
├── AGENTS.md
├── CONTEXT.md
└── docs/
```

Meeting folders live under `20 Supervisor Meetings/` from creation. Their `Meeting.md` status,
not their location, records lifecycle state.

## Placement

Use the first matching rule:

1. A complete book, paper or programme authority used across meetings goes in
   `10 Source Materials/` and receives one Source ID.
2. An email, photograph, scoped extract, handout or other meeting-specific artifact goes in that
   meeting's `Sources/`. Exact copies may appear in another meeting that actually uses them; keep
   the Source ID and verify identical bytes.
3. Source-led learning, source-free Owner questions, exploratory mathematics and research
   discussion go in that meeting's `10 Learning/`.
4. Assigned problems and the attempt/feedback/solutions/concepts workflow go in that meeting's
   `20 Exercises/`.
5. Only Owner-selected and adopted meeting work is optionally promoted: reusable mathematics goes
   in `70 Research/10 Concepts/`; project synthesis goes in `70 Research/20 Research Notes/`.
6. Programme outputs go through Deliverables. Generated orientation aids go in `90 Resources/`.
7. Anything unsupported parks without being moved.

Do not stage speculative literature. A source enters only because the supervisor assigned it, the
Owner supplied it, or current work actually needs it.

## Meeting layout

Number learning units and exercise sets independently from `01`; `00` is allowed only for migrated
pre-cycle work. Each activity area has one `records/` directory. Session records use
`NNNN-slug.md`, sequential from `0001` within that area. Several records may point to one unit or
exercise-set folder. Reuse the current unit or set when the object continues; a new invocation
creates a record, not a workspace. Absence of a Research artifact is a valid completed outcome.

The meeting root holds no loose working files. `Meeting.md` is the controller; `Sources/`,
`10 Learning/` and `20 Exercises/` own everything else.

## Names

- Meeting folder: `YYYY-MM-DD Topic/`; note: `Meeting.md`.
- Learning or exercise folder: `NN Short title/`.
- Session record: `NNNN-slug.md`.
- LaTeX artifact: concise subject plus type, with `.tex` beside its inspected `.pdf`.
- Attempt: source name with `_Attempt`; add a date only for a later attempt at the same set.
- Research artifacts begin with their Research-map key.
- Draft versions use `_Draft_01`, `_Draft_02`; completed artifacts have no `Final` suffix.

Source IDs, Research-map keys and task IDs never change because a display path changes.

## LaTeX

Copy a type from `60 Templates/` into the folder it serves. Compile there with:

```bash
latexmk -pdf -interaction=nonstopmode -halt-on-error -auxdir=build <file>.tex
```

The `.tex` and `.pdf` remain together; auxiliary output stays in `build/`. Inspect the rendered PDF
before reporting it. The shared preamble controls visual style; local divergence is mathematical
notation or macros only.

## Settlement and correction

After Owner confirmation, update `Meeting.md` and settle every Source-register and Research-map
pointer without moving the folder. Correct attributed guidance visibly. A misplaced durable
artifact moves only with every pointer updated. ADRs are superseded, never deleted.
