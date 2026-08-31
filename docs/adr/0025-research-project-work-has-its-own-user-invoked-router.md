# Research-project work has its own user-invoked router

`/research-project <project identity> [-- what to work on]` finds one synced Research-project
folder, reads its live router and project controls, selects the route the requested work belongs
to, then yields to that route. The skill carries no research procedure. It is installed at user
scope beside `/learn`, and fires only when the Owner invokes it.

## Why this is not `/learn`

`/learn` resolves a Module code one semester below `Modules/`, reads the Module's Teaching
procedure, chooses one Source-map unit and stays with the Owner through a teaching session. A
Research project has neither that identity nor that single route: its Definition supplies a stable
project identity, and its router separates Sources, Meetings, Research, Learning, Deliverables,
Tasks and Maintenance.

Making `/learn` detect both folder kinds would give one word two contracts. It would also make an
invocation that named only a project decide whether the Owner wanted Learning, source work or a
deliverable. The separate name keeps Module teaching unchanged and makes the second choice
visible.

## The skill is discovery and wayfinding

The skill searches the two supported macOS Drive mount families below `Modules/Research/` and
keeps candidates carrying a Project Definition. It matches the Owner's project argument against
the Definition's folder, key and title. Resolved paths are compared before selection because one
Drive may appear through both mount families; no match or genuinely distinct matches stop for the
Owner.

After selection, the skill reads `AGENTS.md`, `CONTEXT.md`, the Project Profile and the Project
Definition from the folder on every run. `AGENTS.md` owns the route names and the documents each
route requires. The skill names those routes only to select one; it copies none of their conduct,
artifact formats, registers or mathematical gates.

This is the same boundary ADR-0017 draws around `/learn`: the project folder travels with its
current rules, while an installed skill may be an older copy. Keeping the skill as a pointer makes
staleness fail at discovery or a missing route instead of silently applying an obsolete research
rule.

## It is user-invoked and self-sufficient

Research is too broad a word for implicit invocation, and selecting a project changes the whole
context of a session. The Owner therefore spends the invocation explicitly. Both harness
encodings prohibit implicit invocation.

The installed directory needs no repository clone, academic-os configuration or credential. A
machine that syncs Research-project folders has everything the router reads. The accepted cost is
the same as `/learn`: a copied skill changes only when it is copied again.

## Consequences

Module teaching still starts with `/learn <module code>`. Research-project work may start from any
directory with `/research-project <project identity> [-- what to work on]`, then follows the
selected folder's current controls. Ordinary work begun inside the project folder can still start
at `AGENTS.md`; the skill adds a route in, not a second procedure.

The skill may need amendment if Research projects move out of `Modules/Research/`, a third mount
family becomes supported, or project identity leaves the Definition. A change to research conduct
does not amend the skill; it changes the canonical pinned documents, then reaches each project by
an Owner-approved transition until a project-pinned refresh surface exists.
