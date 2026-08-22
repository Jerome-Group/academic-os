# The teaching skill routes, and the pinned procedure keeps every rule

`/learn` is a skill that resolves a module folder, reads that folder's own
`docs/20 Teaching Procedure.md` and `70 Learning/templates/preferences.md`, proposes which unit is
next, and runs the session under what it just read. It carries no record format, no artifact
naming, no Revisit-register entry kinds, no volume rule and no compile invocation. The pinned
documents keep all of those, and the skill's own text is the one place none of them may appear.

The mechanical test, because a boundary nobody can check is a preference: **if the skill names
`latexmk`, the boundary was drawn wrong.** A test asserts exactly that, which is as far as a test
reaches here — see the Consequences.

## The failures were invocation, never content

A teaching session today starts by running an agent with the module folder as its working
directory; `CLAUDE.md` loads `AGENTS.md`, whose Teaching route points at the pinned procedure. The
first live session found three faults and not one of them was a rule being wrong:

- the session ran from this repository rather than the module folder, so the router never loaded
  and the procedure was read by hand;
- an activity area's `records/` was empty, so *"which lecture-unit is next is read off the
  records"* reconstructed nothing, and the session invented a start;
- nothing resolved a module code to its path. It was typed.

Three defects of getting to the procedure, none of being under it. So the skill is a route, and
the size of the route is the whole decision.

## Why the route is drawn this tightly

Because the copy that motivated it was smaller than this and still shipped wrong. The compile
invocation was written down three times: the spec and the seeded procedure both said
`-outdir=build`, and the prototype's `compile.sh` had `-outdir` **plus** a copy of the PDF back
beside its source. The prototype was the one that worked. The wrong text reached six module
folders, and nothing reconciled the three because nothing could — a spec is not diffed against a
seeded document, and neither is a prototype. [#156](https://github.com/Jerome-Group/academic-os/issues/156)
corrected the procedure to `-auxdir=build`.

A skill that restated the invocation would be the fourth copy, and the worst-placed of them. Every
module's copy of the procedure is diffed byte for byte under MF-AGENTS-004, so a module that drifts
is a finding; nothing diffs a skill against anything. A rule inside it is a rule outside the only
mechanism this system has for catching a stale one.

That is the general form, and it is why the boundary is drawn at "no rules" rather than at "no
rules that seemed likely to change". The invocation did not look volatile either.

## Against putting the procedure in the skill

The obvious alternative — inline the conduct, skip the two file reads, ship one self-contained
file — loses two things.

**The procedure travels with the folder and the skill does not.** A module folder is worked from
whatever harness is in front of the Owner, and the pinned copy is picked up by any of them because
it sits in the folder being worked. A skill is one harness's artifact. Inlining the conduct makes
the good session the one that happened to start through `/learn`, which is precisely the fragility
the router already refuses.

**Contract-versioned text stops being contract-versioned when it is copied.** The procedure changes
by changing `seed-templates/`, and the cohort is brought level by `pinned refresh`. A skill is
changed by editing a skill. Two amendment routes for one rule is the drift above, spelled with
different filenames.

## The one thing the skill says about teaching, and why it is allowed to

Its description names the method: teach the Owner a unit — explain, then check by asking for
something back. That sentence is also in `preferences.md`, so it is a restatement, and it stays.

The name no longer carries it. `teach` did, in the pretrained sense of the word, and `learn` does
not — read cold, `/learn` invites a session to summarise the material at the Owner, which is the
exact conduct `preferences.md` exists to refuse. A description is an invocation pointer rather than
conduct: its job is to make the right thing fire, and a pointer that does not say what it fires is
a skill that fires wrong. One sentence buys that; a second one would be the skill teaching.

## Why the name is `learn`

`teach` collides with the cached upstream `mattpocock-skills` productivity skill, which is on this
machine and visibly the ancestor of this workspace — learning records, a glossary, a resources
file, its `NOTES.md` becoming `preferences.md`. That one is general-purpose, with a mission
document, HTML lessons and printable reference pages; this system is LaTeX artifacts on a Source-map
spine with module-owned unit keys. Same lineage, different shape, so this is a local skill and not
an adoption — and the collision is real rather than hypothetical, because enabling the upstream one
later must not be a decision about this skill's name.

`learn` also matches what is on the tin. The workspace folder is `70 Learning`, its artifact is a
Learning record, and `/learn MODULE_CODE` reads as an instruction where `learn-unit` reads as the
agent doing the learning. `teaching-session` is the glossary's phrasing and loses on length alone.

## Where it lives and how it fires

The source is `skills/learn/` in this repository, installed at user scope by symlink. Two
consequences follow from that and both are the point.

**Not `.claude/skills/`.** A project-scoped skill is discovered only when the working directory is
this repository, and the working directory not mattering is the defect being fixed. User scope is
what makes `/learn` reach from anywhere; the repository is what makes it reviewed, versioned and
public with the rest of the system.

**User-invoked** — `disable-model-invocation: true`. `/learn` is a generic enough verb to be a
magnet in any repository, and a teaching session starts when the Owner says so. It costs the
description's discoverability, which is the correct trade for a skill with exactly one caller.

## The first-session gap is answered by asking

An activity area with no records has nothing for *"which lecture-unit is next is read off the
records"* to read. The skill proposes a unit by diffing the Source map's keys against what the
records already cover, and **asks** when that is empty or ambiguous — rather than the contract
growing a first-session fallback rule.

Asking is cheaper and it is also more correct. A fallback would have to guess an ordering the
Source map does not promise, and it would be a new pinned rule in six folders to fix one moment
that happens once per area. The Owner is in the room for a teaching session anyway.

## Consequences

The skill can go stale in exactly one way, and it is a narrow one: routing. If a pinned document is
renamed or the configuration's shape changes, the skill's reads break — loudly, at the top of a
session, rather than quietly in an artifact.

MF-AGENTS-004 reaches every module's copy of the procedure and reaches no skill, so most of this
boundary is held by review rather than by a check. One part of it is not, and it is the part the
record was written about: a test refuses a compile invocation in the skill's text. The rest — a
record format, an artifact naming rule, a Revisit entry kind, a volume rule — needs judgement to
recognise, so it arrives in a pull request or not at all.

`/learn` needs `academic-os.config.json` on the machine it runs from, which the second-machine
checklist in `docs/machine-setup.md` does not otherwise require. A machine without it runs teaching
sessions the way they ran before — from the module folder, through the router — and that path is
not withdrawn.

There are now two homes for agent-facing routines: `docs/agents/`, whose files are prose reached by
a pointer in `AGENTS.md`, and `skills/`, whose files are harness-installed and invoked by name.
`MAP.md` names both. A third home is a smell.

## Revisit when

A second harness needs the same routing. The route stops being a skill's business at that point and
wants a form both can read — most likely a command in this repository's own CLI, with the skill
reduced to calling it.

The Teaching procedure grows a rule that cannot be read at run time — one about the session's own
tooling rather than about the module's material. That is the first rule with a real claim to living
in the skill, and it reopens the split rather than being quietly filed on one side of it.
