# Curation Procedure

Everything an importer has left for MODULE_CODE, decided and recorded. One pass walks each importer
root in full, gives every file it finds a line in `00 Module Admin/20 Curation Register.jsonl`, and
copies out the files that belong in the module's own directories under their curated names.

One procedure, whatever invoked it: an unattended morning pass and an ad-hoc "curate" run the same
steps against the same register. The Owner being present changes one thing, said where it applies.

Read `docs/00 Structure and Naming.md` first. Destinations and curated names are its rules; this
procedure decides which of them an item gets.

## Identity

Two things together identify an item, and the pass establishes both from the files in front of it:

- **The unnumbered source path** — the item's path inside its importer root with the `NN ` prefix
  stripped from every segment, folders included. The number is an ordering that shifts when
  material is inserted upstream or renumbered; the name behind it is what stays.
- **The checksum** — sha-256 of the file's bytes, computed by this pass.

Whatever an importer or an earlier pass cached about a file is one run's working note. The bytes on
the mount and the register are the two authorities here, and a pass leaves nothing behind but its
own decision lines.

## The walk and the join

Walk every importer root the Module Definition declares, in full. An importer only adds and only
touches what changed, so the mirror is the complete picture of what has arrived; the register's
newest timestamp may narrow the walk by modification time, and where the two disagree the walk
decides.

Join each file found against the register on both halves of its identity:

| The join | What it means | What the pass does |
| --- | --- | --- |
| Path and checksum both known | Already decided | Leave it — the standing line covers it |
| Path known, checksum new | An **update arrival** | Decide it again, superseding the earlier line |
| Checksum known, path new | Known bytes, filed twice upstream | `source-only`, its evidence naming the original decision |
| Neither known | A new item | Classify it |

Every file the mirror holds ends the pass carrying a line. A line whose source is no longer in the
mirror is the join running the other way: the curated copy stays exactly where it is, and the
missing source is surfaced as a discrepancy.

## Classification

Two kinds of file, and only one of them costs judgment.

**The importer's own writing is `source-only`, deterministically** — the course page, the sync
stamp, announcements, item pages, folder pages, and any stand-in marked
`<!-- ntulearn: nothing to copy -->`. These are the mirror describing itself.

**Attachments are classified by precedent.** The register is the rule book: find the lines whose
items match the one in front of you — same importer folder, same kind of material, same role in the
module — and decide as they decided. With the Owner present, an item with no precedent is a
question to ask in the session; their answer becomes the line's evidence, and so the precedent the
next pass follows.

Park when the register offers nothing to follow, and park when it offers two things that disagree.
Settling a precedent is a decision, and a decision is the Owner's.

## Sequence numbers

A curated name's number is read from the source's own naming — the item's title, or the
attachment's own filename. A mirror folder's `NN ` prefix is the importer's ordering, and never the
number in a curated name.

A source that numbers itself nowhere is an ambiguity: park it, and the Owner's ruling on that one
item is the precedent every later item of its kind reads.

## The four decisions

| Decision | The item | The line also carries |
| --- | --- | --- |
| `curated` | Belongs in the module's own directories as a renamed copy | its destination |
| `source-only` | Stays in the mirror and is read there | — |
| `rederived` | Its content went into module docs, notes or the profile rather than into a copy | the derived artifacts' paths |
| `requires-decision` | Parked | what was ambiguous, in its evidence |

`rederived` is what much of a mirror actually earns: the item was worked, its content is now
somewhere in the folder, and no verbatim copy was the right output. Recording it closes the item as
firmly as a copy does.

**An update arrival supersedes on one condition.** Compare the placed copy against what the earlier
line placed. Byte-identical — nothing has been done to it — the new bytes replace it and a
superseding line records that. Anything else — annotated, graded, edited, moved away — parks, and
the placed copy holds its ground.

## Two sources, one item

Two files in the mirror can be the same lecture, sheet or handout. What separates them decides
whether the module ends up holding one copy or two.

**A clean copy and an annotated copy are two artifacts.** The clean one is what the module issued
and the annotated one is what happened in the room, so both curate: the annotated copy takes the
clean one's number and topic and adds `Annotated`, and neither line contests the other's. The
number and the topic are read from the clean copy, so an annotated copy that arrives before its
clean counterpart parks.

**Two live paths are two issues of one artifact.** The site reissued the material and left the
earlier copy standing, so both walk in as new items and both build one curated name. The newer
issue curates and the earlier is `source-only`, its evidence naming the issue that took the name.
Which is newer is read from the source — a release date in the filename, a stated revision, one
text carrying the other's with more added — and that date belongs to the evidence rather than to
the name, so a Learning record, a `40 Source Map.yaml` entry or a task pointing at the curated copy
survives the reissue. Where the earlier issue is already placed, the newer replaces it and
superseding lines record both, under the comparison an update arrival gets: a placed copy that has
been worked on holds its ground and parks.

Park two sources holding different material — those are two items, not two issues of one — and park
two sources where nothing says which is newer.

## Naming and destinations

A `curated` decision takes its destination and its curated name from
`docs/00 Structure and Naming.md`, and both freeze in the register line at the moment of the
decision. That line is the record of where the item went and what it is called, so a later rename
or move contradicts it — a correction to show the Owner, rather than routine work.

## The register line

One line per decision, appended, JSON:

```json
{"schema_version":2,"source_id":"Lectures/Graph Theory/slides.pdf","integration":"NTULearn","role":"lecture","source_path":"03 Lectures/03 Graph Theory/slides.pdf","checksum":"<sha-256 of the source bytes>","decision":"curated","destination":"10 Learning Materials/10 Lecture Materials/MODULE_CODE_Lecture_03_Graph_Theory.pdf","evidence":"Follows the standing precedent for lecture slides.","timestamp":"2026-08-17T06:04:11Z"}
```

- `schema_version` is 2 — the version that carries `rederived`. Version 1 lines are valid history,
  read as they stand; nothing rewrites them.
- `source_id` is the item's unnumbered identity, `source_path` its path inside the importer root as
  walked, and `checksum` the sha-256 this pass computed.
- `integration` names the importer root the item came from; `role` says what the item is to this
  module.
- `destination` is module-relative and belongs to `curated` lines. A `rederived` line carries the
  derived artifacts' paths in `derived` instead.
- `evidence` says why — the precedent followed, the Owner's words, the module ADR the rule lives
  in, or what was ambiguous.
- `timestamp` is the ISO 8601 instant of the decision; `supersedes` names the event this one
  replaces.

The register is append-only history, and a superseded line stays where it is. Reading the file top
to bottom is how this module's precedent is reconstructed.

## Parking

Parking is the item's outcome, never the pass's. The pass finishes everything unambiguous, and each
parked item is left exactly as it is — nothing copied, nothing renamed — with a `requires-decision`
line whose evidence names what was ambiguous about it.

Open `requires-decision` items are the first thing the next pass presents: in the session when the
Owner is present, in the run's report when not. One odd file is a question waiting, and the morning
around it is still curated.
