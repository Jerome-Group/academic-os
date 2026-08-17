# Seed-source templates

The canonical bodies of the pinned files a module folder is seeded with. Seeding will write them
into a new module folder; the auditor will diff each module's copy back against them. These files,
and never a copy in Drive, are what "pinned" means.

## Ahead of contract v4

Nothing reads this directory yet, and the bodies here are version 4's. `docs/module-folder-contract.md`
is still at version 3, and version 3 is what seeded modules are audited against — including the
`AGENTS.md` shape `src/seed/create-module-seed-plan.ts` writes and `src/conformance/validate-agents.ts`
checks, which is not the router here. Version 4 brings the readers: the pinning rule
(MF-AGENTS-004), the tree these bodies describe, MF-AGENTS-001 rewritten around this router, and
the Curation-register line schema's version 2 — the `rederived` decision the curation procedure
here already runs on. Until it lands, a module folder that disagrees with a template here is not
yet a finding.

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

## What lands here next

The last pinned doc — `docs/20 Teaching Procedure.md` — and the seeded LaTeX set for
`70 Learning/templates/`.
