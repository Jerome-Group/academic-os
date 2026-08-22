# A control is written or pinned, and the map that lists them all is the union

`writtenControlPaths` holds the controls this system writes and reads back. `pinnedDocumentPaths`
holds the ones this repository authors and seeds. `moduleControlPaths` is the union, and it is what
the contract's `## Module controls` section names.

## The premise this started from was wrong

[ADR-0015](0015-teaching-preferences-are-pinned-and-latex-is-not.md) recorded, as a cost of pinning
the teaching preferences, that "`moduleControlPaths` is a name that no longer says so". Two
independent reviews of a later change agreed, reading `70 Learning/templates/preferences.md` in a
map called *control* paths as a category error.

It was not one. `## Module controls` in the contract contains `### Agent and domain controls`, which
is where MF-AGENTS-001, MF-AGENTS-002, MF-AGENTS-004 and MF-CONTEXT-001 live — so `AGENTS.md`, the
four `docs/` procedures and now `preferences.md` are module controls by the contract's own
sectioning, and always were. The map was accurate. What had changed was only that controls stopped
being confined to the module root, `docs/` and `00 Module Admin`, which is exactly what ADR-0015's
neighbouring sentence says.

Splitting the union into "controls" and "not controls" would have written that error into the code
and contradicted a normative document. The reviews that caught the smell were reading the variable
name, and so was the record before them.

## What actually divides them

Not what they are, and not where they live: **how a valid one is recognised.**

A **written control** is module state, and only its own rule can say what a valid one looks like —
the Profile's heading order, the Definition's schema, a register's line shape. Eight rules, eight
validators, eight shapes.

A **pinned control** is this repository's own text, so validity is one question asked the same way
every time: does this copy match the template it was seeded from, byte for byte? That is
MF-AGENTS-004, one rule for all six.

The two halves are therefore what a *validator* needs, and the union is what a *reader* needs, since
an audit opens every control whole regardless of how it will be judged. Each of the three names now
says which of those jobs it is for.

## Consequences

A validator takes its one path from the half that owns it, so `validateAgents` reads
`pinnedDocumentPaths` while `validateProfile` reads `writtenControlPaths`. Adding a control means
choosing a half, and the choice is the same question as "what makes it valid" rather than a
guess about a location.

`ModuleControls`, `readModuleControls` and `auditModuleControls` keep their names, because the bag
they carry is the module's controls and always was.

Nothing about the audit changes, and this record claims that having checked: the cohort's JSON
report is identical before and after, 493 findings across six modules, once the per-run observation
stamps are set aside.

`controlPaths` in `contract-paths.ts` still lists nine of these paths a third time, keyed by
basename for misplacement detection. That is a real duplication and this record does not resolve it.

## Revisit when

A pinned control needs a rule of its own beyond the byte diff, or a written control becomes
something this repository authors whole. Either collapses the distinction this rests on.
