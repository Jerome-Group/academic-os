# The teach skill's session records, and a math-first `70 Learning`

Research date: 2026-08-14. Answers issue #67.

## Sources

Read from the installed plugin cache,
`~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.2.2/skills/productivity/teach/`:

- `SKILL.md` — the workspace layout, philosophy, and lesson rules.
- `MISSION-FORMAT.md` — the `MISSION.md` template and rules.
- `LEARNING-RECORD-FORMAT.md` — the record template, numbering, and supersession rules.
- `RESOURCES-FORMAT.md` — the trusted-sources file structure.
- `GLOSSARY-FORMAT.md` — the canonical-terminology file structure.
- `agents/openai.yaml` — interface metadata only; nothing persisted.

Repo context: `CONTEXT.md` ("Teaching workspace"), `docs/module-folder-contract.md`
(MF-OPEN-001, MF-LATEX-001, MF-NAMING-002).

## What the skill persists between sessions

The skill declares the request stateful — the user "intend[s] to learn the topic over multiple
sessions" — and makes the current directory the teaching workspace. Everything persistent is a
plain file in that directory:

| Artifact | Format | Role |
| --- | --- | --- |
| `MISSION.md` | Single short Markdown file: Why / Success looks like / Constraints / Out of scope | The reason for learning; every teaching decision traces to it. One mission per workspace. |
| `learning-records/NNNN-slug.md` | Numbered Markdown, `0001-` up; title plus 1–3 sentences, optional Status / Evidence / Implications | The teaching equivalent of ADRs. Written only on evidence of understanding, disclosed prior knowledge, a corrected misconception, or a mission shift. Superseded, never deleted. |
| `lessons/NNNN-name.html` | Numbered self-contained HTML | The unit of teaching: one tightly-scoped thing, completable quickly, tied to the mission. |
| `reference/*.html` | HTML cheat sheets designed to print well | Compressed essence of lessons. "Lessons will rarely be revisited later - reference documents will be." |
| `RESOURCES.md` | Markdown, grouped Knowledge / Wisdom (communities), optional Gaps | Curated high-trust sources; the skill forbids trusting parametric knowledge before this exists. |
| `GLOSSARY.md` | Markdown term list with canonical definitions and aliases to avoid | Canonical language; a term is added only once the user understands it. |
| `assets/*` | Stylesheets, quiz widgets, simulators | Reusable components; a shared stylesheet is "the first component every workspace earns". |
| `NOTES.md` | Freeform Markdown | Agent scratchpad for the user's teaching preferences. |

Deliberately **not** persisted: session journals ("Learning records are not a journal"),
transcripts, coverage logs, and — notably — any spaced-repetition state. Spacing is named as a
principle (fluency strength vs storage strength; retrieval practice, spacing, interleaving) but
no file carries due dates or a review queue.

## The session loop, and how it resumes

There is no cursor file and no resume protocol. Resumption is reconstruction from the workspace:

1. **Reads first:** `MISSION.md` (if absent or vague, the first job is to interview the user and
   write it), then `learning-records/` to compute the zone of proximal development — the records
   are the floor of what is already known — plus `NOTES.md` for preferences, `GLOSSARY.md` for
   language, `RESOURCES.md` before trusting any claim, and `assets/` before authoring anything.
2. **Teaches:** one lesson in the zone of proximal development — knowledge first, then skill
   practice through the tightest feedback loop available, ideally automatic.
3. **Writes last:** the new lesson (next number), any reference document it earned, glossary
   terms the user now demonstrably understands, and a learning record only if one of the four
   qualifying events happened. Contradicted records get `Status: superseded`, not deletion.

The de-facto resume cursor is the highest number in `lessons/` and `learning-records/`, plus the
content of the records themselves. What was merely covered leaves no trace by design — "Coverage
is not learning" — so a resumed session re-teaches anything that never produced evidence.

## Code-shaped (really: browser-shaped) assumptions

- Lessons and references are HTML, linked by anchors, opened via a CLI command, styled by a
  shared stylesheet in `assets/`.
- The feedback loop is in-browser and automatic: quiz widgets, simulators, light interactive
  tasks, with formatting-neutral multiple-choice answers.
- The worked examples of reference material are syntax snippets, algorithms, flowcharts.
- Wisdom is outsourced to online communities found by the agent.

## Transfer to a math-first `70 Learning`

Repo framing: the Teaching workspace is "the `70 Learning` half of the contract" and its internal
contract is deferred (`CONTEXT.md`). MF-OPEN-001 places the interior of `70 Learning` outside
structural enforcement, and MF-NAMING-002 exempts its files from curated naming — so any layout
below can be **piloted per module without a contract change**; only promoting one to a rule later
is an edit to `docs/module-folder-contract.md`. MF-LATEX-001 already governs the LaTeX half:
`build/` beside each compilation workspace, created only when LaTeX appears, and user-facing PDFs
beside their source.

### Keep

- **`MISSION.md`** — unchanged. Per module workspace, grounded in the module's outcomes and
  assessments; "one mission per workspace" maps cleanly to one workspace per module folder.
- **Learning records as ADRs** — unchanged in mechanism; this repo already thinks in ADRs. The
  math events are the same four: a proof reproduced unaided (evidence, not exposure), disclosed
  prior knowledge, a corrected misconception (wrong quantifier order, an unjustified limit swap),
  a mission shift. Evidence-gating and supersession transfer intact and matter more, because in
  proof work the illusion of fluency — recognising a proof is not reproducing it — is the
  central failure mode the fluency/storage distinction warns about.
- **`GLOSSARY.md`** — keep, and it is stronger in math: definitions and fixed notation are the
  subject. Extend the term entry with a notation column; "add only when understood" is exactly
  the right gate for definitions the user must wield in proofs.
- **`RESOURCES.md`** — keep the format. Knowledge entries point at what curation already placed
  in `10 Learning Materials/20 Textbook Chapters` and `10 Lecture Materials` rather than the
  open web; the never-trust-parametric-knowledge rule is the right posture for proofs too.
- **`NOTES.md`** and **numbered artifacts as the resume cursor** — keep as-is; sequential
  numbering also matches the repo's numeric-prefix habits, and MF-NAMING-002 permits the
  skill's `NNNN-dash-case` names inside `70 Learning` untouched.

### Adapt

- **Lessons: HTML → LaTeX compiled to PDF.** The unit survives — one tightly-scoped derivation
  or proof technique per lesson, short, in the zone of proximal development — but the artifact
  becomes `lessons/NNNN-name.tex` with its PDF beside it and one shared `build/` beside the
  lesson directory (simple files sharing a directory may share its build directory,
  MF-LATEX-001). "Beautiful … Think Tufte" costs nothing here; well-set LaTeX is the native
  form of the material. "Open via CLI" becomes opening the compiled PDF.
- **`assets/` → a shared preamble.** The reuse-by-default rule transfers whole: the "first
  component every workspace earns" is a `.sty`/preamble of macros, theorem environments and
  notation that every lesson inputs, which is what makes the glossary's canonical notation
  enforceable across lessons.
- **Reference documents** — keep the compressed, print-well intent; the math instances are
  theorem and identity sheets, proof-pattern sheets ("to show a map is injective…"), and the
  glossary. LaTeX/PDF instead of HTML.
- **The feedback loop.** Automatic in-browser checking does not survive; the honest math
  equivalent is model-solution gating: exercises whose solutions live in a separate file or
  behind a toggle, the user attempts the proof cold, then self-checks against the model —
  with the agent in-session as the reviewer of the user's attempt. The loop is looser than a
  quiz widget; the skill's own advice (feedback as tight as possible) still points the design.
- **Wisdom/communities** — the module already ships its community: tutorials, TAs, peers.
  `RESOURCES.md`'s Wisdom section points there first, external forums second.

### Replace

- **Spacing.** The skill's largest gap for this use: spaced revisiting is named as pedagogy but
  has no persisted state — nothing is due, nothing queues. A proofs workspace needs real
  schedule state: a review-queue file in the workspace (each learning record or reference sheet
  carrying a next-revisit date) or, since this repository's issue tracker is the semester's task
  list, revisit issues on the tracker. Either way it is new machinery, not an adaptation.
- **Quiz widgets and simulators.** Replaced by proof-reproduction and gap-proof exercises
  (a proof with justifications elided, to be filled), which live naturally in the LaTeX lesson
  rather than in `assets/` interactivity.

## Decision-ready summary

The teach skill persists eight plain files/directories and resumes by re-reading mission,
records, notes and glossary — the numbered records are both the memory and the cursor. Its
mission/records/glossary/resources spine is medium-agnostic and transfers to `70 Learning`
as-is; its artifact layer (HTML lessons, assets, in-browser feedback) adapts cleanly to LaTeX
lessons with a shared preamble, PDFs beside sources and `build/` per MF-LATEX-001; the one thing
it genuinely lacks for proofs-and-derivations work is persisted spaced-revisiting state, which
must be added, most naturally through this repository's own tracker. All of it can be piloted
inside `70 Learning` today under MF-OPEN-001 without touching the contract.
