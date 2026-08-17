# PROTOTYPE — one teaching session's artifacts in `70 Learning`

**Throwaway.** This tree exists to be reacted to on
[ticket #78](https://github.com/Jerome-Group/academic-os/issues/78) and lives only on the
`prototype/teaching-session-artifacts` branch, per `docs/agents/workflow.md`. Nothing here is
imported from a module folder: the lesson, records and register entries were authored for this
prototype (ADR-0002 holds).

## The question this answers

Which template style becomes the repo-canonical set that seeding copies — chosen by the Owner
from rendered candidates — and whether the settled `70 Learning` shape (#71) feels right in
the hand.

## What to look at

The same Week 03 lesson (MH2100 Calculus III — partial derivatives and the chain rule),
rendered four ways in `70 Learning/10 Lectures/Week 03/`:

| PDF | Register |
| --- | -------- |
| `Walkthrough Partial Derivatives (Style A).pdf` | **Classic** — Latin Modern, monochrome, run-in heads; a mathematician's own notes |
| `Walkthrough Partial Derivatives (Style B).pdf` | **Boxed** — Palatino, colored definition/theorem/warning boxes; modern course notes |
| `Walkthrough Partial Derivatives (Style C).pdf` | **Engineered** — compact kpfonts, small caps, rules only; datasheet register |
| `Walkthrough Partial Derivatives (Style D).pdf` | **Two-column compact** — 9pt, densest candidate; tests where space-dense stops |

The body is byte-identical across all four (`walkthrough-body.tex`); each style is one file in
`70 Learning/templates/`, implementing the same semantic interface
(`preamble-common.tex`).

Around the walkthrough, the settled shape from #71, filled for one session:

- `70 Learning/10 Lectures/records/0001…` (session) and `0002…` (understanding) — the
  deterministic header in use.
- `70 Learning/REVISIT.md` — a confusion entry and an agent-nominated exam-important entry.
- `70 Learning/GLOSSARY.md`, `RESOURCES.md` — the slimmed spine.
- `00 Module Admin/40 Source Map.yaml` — the unit key `Week 03` the folder is named for,
  listing two lecture parts plus a textbook chapter (the multi-file case). Schema
  illustrative.

## Rebuild

```
./compile.sh
```

Requires a TeX Live/MacTeX install (`latexmk` on PATH). Aux output lands in `build/` beside
the sources (MF-LATEX-001); the user-facing PDFs are copied beside their source.
