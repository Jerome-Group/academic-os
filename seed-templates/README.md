# Seed-source templates

The canonical bodies of pinned files seeded into Module and Research-project folders. Seeding writes
them into a new target; audit diffs each pinned copy back against its aggregate's templates. These
files, and never a copy in Drive, are what "pinned" means.

## What reads them

`AGENTS.md` and the five `docs/` templates are what `src/seed/create-module-seed-plan.ts` writes
into a module folder, and what `src/conformance/validate-pinned-documents.ts` diffs each module's
copy back against under MF-AGENTS-004.

`research-project/` mirrors a Research-project folder. Its `AGENTS.md` and four numbered
procedures are pinned under RP-AGENTS-004; its controls and Research templates are canonical seed
bodies, with caller-supplied Profile and Definition taking their two destination paths. Research
templates are starting interfaces rather than pinned local instructions.

Module `docs/40 Cheatsheet Procedure.template.md` is the conduct source reached by the
user-invoked `/cheatsheet` router.

## The path is the destination

A template's path here is its path inside the module folder, with `.template` before the
extension: `AGENTS.template.md` seeds `AGENTS.md`, and `docs/00 Structure and Naming.template.md`
seeds `docs/00 Structure and Naming.md`. The infix is what keeps a module's router from being read
as instructions for this repository, and it is what marks a file as seeded — this README carries no
infix and reaches no module.

`MODULE_CODE` is the only token seeding substitutes, and so the only thing that may differ between
two modules' copies. Module-specific content belongs in `CONTEXT.md`, `docs/adr/`, the Profile, or
the optional unseeded `70 Learning/preferences.local.md` for evidenced standing teaching conduct.

Inside `research-project/`, the path after that directory is the Research-project destination and
the `.template` infix is removed. `{{PROJECT_NAME}}` is its sole interpolation token. A template
that wants to say something true of one project has found content for that project's Profile,
Definition, `CONTEXT.md`, `docs/adr/` or registers.

## Changing one

A change here reaches every module folder by transition or repair, which makes it a change to the
contract's own text:

- Load `/mattpocock-skills:writing-for-agents` and apply its levers alongside the change.
- Name the exact file and section before editing; use the authorization already given for the task.
- A change that outruns `docs/module-folder-contract.md` is a contract change, and lands in the
  same pull request.

## The LaTeX set

`70 Learning/templates/` seeds seven artifact types, their preambles, a portable logo dependency
and `preferences.md`. The six ordinary teaching types retain their shared `preamble.tex` and
existing appearance. `mathematics-cheatsheet.tex` is the filled original specimen for the separate
compact monochrome interface in `mathematics-cheatsheet-preamble.tex`; `chatgpt-logo.tex` carries
its local vector asset. Type files carry semantic structure and content. Their selected preamble
carries visual decisions, including fixed typography and the actual font sizes used by large
operators.

Two things a reader would otherwise find out the hard way:

- **A type file reaches its selected preamble from either place.** Its input line tries the
  preamble beside it and falls back two levels up, so the same file compiles here in `templates/`
  and as a copy in a unit folder, with no path to edit.
- **They compile in their seeded form, not this one** — here support files still carry the
  `.template` infix. `npm run templates:check` materializes seeded filenames in a temporary
  workspace and compiles each document against its declared support files. CI runs the same check
  after installing TeX Live.
