# Teaching preferences are pinned, and the LaTeX set is required by name

`70 Learning/templates/preferences.md` joins the pinned documents and is diffed back byte for byte
under MF-AGENTS-004. The seven `.tex` files beside it are required **by name** under
MF-LEARNING-001 and their contents are free. Before this, `templates/` was required as a directory
and nothing more, so a module could delete all eight seeded files and audit clean.

## Why the preferences file is pinned and the templates are not

They look like one directory and they are two different kinds of thing, which is what the old rule
missed. MF-LEARNING-001 governed both with one sentence — "A module edits a template where the
difference is functional; the rendered page stays the same across modules" — and that sentence
cannot reach `preferences.md`, which renders no page at all.

The preferences file says how it changes, in its own last section: a preference the Owner accepts
in a session "makes it a change to the seeded set", and "a preference true of one module alone
belongs in that module's `CONTEXT.md`". There is no per-module branch in that route. Every copy is
already one text by construction, so the pin adds no constraint — it checks a property the file
asserts about itself, and turns a silent drift into a finding.

The `.tex` set is the opposite. A module is *supposed* to diverge there — macros, environments,
notation shortcuts — so long as the rendered page does not move. Pinning them would forbid what the
contract invites, which is the obvious option and the wrong one: it would read the eight files as
one policy because they share a directory.

## Why the guarantee was made true rather than softened

The alternative was to soften MF-LEARNING-001 to promise the template set at seeding time only,
which is what it actually delivered. That is cheaper and it is the wrong direction. The sentence
reads as a durable guarantee because a reader has no reason to hear "once, at creation" in it, and
a rule nobody can misread is worth more than a rule that is merely accurate about a weaker promise.

Requiring the names costs a module nothing it was permitted to do. Editing a template stays legal.
Deleting one is not contemplated anywhere in the contract or in the Teaching procedure, so nothing
that was allowed becomes forbidden — only something undefined becomes defined.

## The contract version holds at 4

This adds a normative requirement, and the version rule says to increase it when one changes. It
does not, and the reason is what the version is *for*: it gates a folder missing structure the
current contract requires, which MF-TRANSITION-001 installs one module at a time on the Owner's
approval. No folder is missing this structure. Seeding has written all eight files since the
Teaching workspace existed, and all six Y2S1 modules hold them, with `preferences.md`
byte-identical to its template in every one.

So a bump would mark six conformant folders upgrade-required and hold ordinary auditing behind six
transitions whose structural work is already done — to catch a case none of them are in. The case it
does catch, a module that deleted a seeded template, is deviation: the repair writes the one file
back from `seed-templates/`, with no module-local item to re-home and so no judgment for a
transition to carry.

## Consequences

An edit to a module's `preferences.md` is now a deviation the audit reports, repaired by rewriting
the copy rather than by keeping it. A module that wants teaching conduct of its own has two places
and this is neither: a preference the Owner accepts changes the seeded set and reaches every module,
and a preference true of one module is a `CONTEXT.md` entry.

`preferences.md` becomes a module control, so the mounted and Drive readers fetch one more file per
module and the auditor holds its body in memory. It is the first control outside the module root,
`docs/` and `00 Module Admin` — the set is now defined by which documents are pinned rather than by
where they sit, and `moduleControlPaths` is a name that no longer says so.

Two rules report on the same path: MF-LEARNING-001 that `preferences.md` is present, MF-AGENTS-004
that it is unchanged. That is two questions with two repairs — seed the file, or rewrite it — rather
than one question asked twice.

## Revisit when

A module has a functional reason to diverge in `preferences.md` that `CONTEXT.md` cannot carry. The
pin rests on the amendment route having no per-module branch; a real case for one reopens the route
before it reopens the pin.

The template set changes shape — a type added or retired. The names are enumerated in
`learning-workspace.ts` and a new template must join them, or it is seeded and unenforced, which is
the state this record ended.
