# Seed-source templates

The canonical bodies of the pinned files a module folder is seeded with. Seeding writes them into a
new module folder; the auditor diffs each module's copy back against them. These files, and never a
copy in Drive, are what "pinned" means.

## Ahead of the rest of contract v4

The pinned docs layer is live: `AGENTS.md` and the four `docs/` templates are what
`src/seed/create-module-seed-plan.ts` writes into a module folder, and what
`src/conformance/validate-pinned-documents.ts` diffs each module's copy back against under
MF-AGENTS-004.

Three things here still outrun their readers on `integration/contract-v4`, the branch that layer
landed on:

- The contract's version line reads 3 until the chain's last batch flips it, so a cohort module is
  audited against version 3 until then.
- `70 Learning/templates/` reaches no module folder until MF-LEARNING lands the workspace.
- The curation procedure here runs the `rederived` decision, which the Curation-register line
  schema does not yet carry.

## The path is the destination

A template's path here is its path inside the module folder, with `.template` before the
extension: `AGENTS.template.md` seeds `AGENTS.md`, and `docs/00 Structure and Naming.template.md`
seeds `docs/00 Structure and Naming.md`. The infix is what keeps a module's router from being read
as instructions for this repository, and it is what marks a file as seeded — this README carries no
infix and reaches no module.

`MODULE_CODE` is the only token seeding substitutes, and so the only thing that may differ between
two modules' copies. A template that wants to say something true of one module has found something
belonging in that module's `CONTEXT.md`, `docs/adr/` or profile.

## Changing one

A change here reaches every module folder by transition or repair, which makes it a change to the
contract's own text:

- Load `/mattpocock-skills:writing-for-agents` and apply its levers alongside the change.
- Show the Owner the exact new wording before applying it.
- A change that outruns `docs/module-folder-contract.md` is a contract change, and lands in the
  same pull request.

## The LaTeX set

`70 Learning/templates/` seeds `preamble.tex`, one file per artifact type named for that type, and
`preferences.md`. The preamble holds every visual decision, and holds them exactly as the Owner
chose them on `prototype/teaching-session-artifacts`: Latin Modern on a tight monochrome page,
run-in theorem heads, warnings as red-edged boxes on the shared theorem counter. What the preamble
adds beyond that branch is the semantic interface — the header macro and the environments the six
types write against — which is where a one-type prototype had nothing to say. A type file carries
structure and placeholder prose and no styling at all, and that separation is what lets a module's
divergence stay functional rather than visual.

Two things a reader would otherwise find out the hard way:

- **A type file reaches the preamble from either place.** Its input line tries `preamble.tex` beside
  it and falls back two levels up, so the same file compiles here in `templates/` and as a copy in a
  unit folder, with no path to edit.
- **They compile in their seeded form, not this one** — here the preamble is still
  `preamble.template.tex`. `npm run templates:check` strips the infix into a temporary directory and
  runs `latexmk -pdf -outdir=build` over each type. CI runs it too, on a runner it installs TeX Live
  onto, so a broken template cannot merge; run it locally as well, because the round trip through a
  red job is the slow way to find a missing brace.
