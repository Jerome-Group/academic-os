# Evidence cites the most durable form available, and a mirror path is the last of three

> **Superseded by [ADR-0014](0014-evidence-cites-ntulearn-and-never-a-path-into-it.md).** Evidence
> cites NTULearn only, and never a path into a mirror. The durability order below put an official
> NTU URL first, which this system does not want, and demoted rather than removed the interior
> path — de-numbering a citation treats the symptom of recording a position at all. What stands is
> the reasoning that made the second half look sufficient at the time.

Evidence names the most durable form the document has:

1. the **official NTU URL**, where the document is published — a syllabus, an OBTL, a course
   guide;
2. the importer's **fixed landmarks** — `Course.md`, `Last synced.md`, `Announcements/`, the three
   names the importer guarantees;
3. an **unnumbered path into the importer's interior**, with each segment's `NN ` prefix removed,
   folders included.

The third is a fallback rather than a default, and when a citation lands there it is unnumbered.
Those are one decision because the second half is only worth having once the first half has sent
most citations somewhere better.

## Why the interior is last

A mirror is an automated landing zone. The importer writes it, the importer numbers it, and the
number is that importer's position at first write: an insert upstream renumbers every later name
while nothing on disk moves, and only a deliberate, manual `renumber` repairs the disk. The
importer's own resolver strips the prefix before it matches, and the curation join matches
unnumbered for the same reason. A citation carrying the number is the one place in the system
claiming the ordering is an identity.

That failure has already happened twice, and neither time looked like a broken pointer. A syllabus
cited at slot 10 resolved to the supplementary material that later filled the slot — a pointer
that answered with unrelated material rather than with nothing. Three curated files were reported as
having no register line at all, because a search by their current numbers missed the older numbers
their lines record; the curation join was unaffected, because it matches unnumbered.

But unnumbering only removes the churn the **importer** generates. Nothing about it survives
NTULearn renaming the folder or the item, and because a sync never deletes from a destination, the
old copy stays beside the new one rather than disappearing where a reader would notice. So an
unnumbered interior path is a better pointer than a numbered one and still a weak one, which is
what puts it third rather than first.

The cohort had already found this out without writing it down. Of six modules, the only one whose
evidence needed no repair is also the only one citing official NTU URLs; every module's durable
citations are `Course.md` and `Announcements/`; and the six interior paths between them were
exactly the six that carried stale numbers.

## Why not both forms, and what the fallback costs

Citing the unnumbered path with the current number in a parenthetical was rejected. The
parenthetical is the half that goes stale, sitting beside the half that does not, in a record
nothing renumbers — and once the two disagree there is no rule saying which a reader believes.

The fallback's cost is real and paid on every read: an unnumbered path is not a string that
resolves as typed. A reader opens the importer root and finds the name, which is one glance because
the number is a prefix and the mirror lists in order. Tooling strips `^\d+ ` per segment, which is
what the importer's resolver and the curation join already do.

## Where the rule stops

Numbers outside an importer root are this contract's own and do not shift, so
`00 Module Admin/10 Module Definition.yaml` is cited exactly as it is spelled. The root a citation
opens with is what decides whether its numbers are ordering or spelling, which is also how the
check tells them apart.

The Curation register's `source_path` keeps the numbers the walk saw. That line is an append-only
observation of where an item stood when a decision was made, not a pointer for a later reader to
follow; its `source_id` is already the unnumbered identity, and the checksum beside it is what
settles which item a line means. Rewriting history to a form the walk never saw would cost the
register the one thing it is for.

## Consequences

**The tier is checked and the choice is not.** Whether a citation landed on the interior is
decidable, so the auditor names it. Whether it could have landed higher is not — nothing in a
module folder knows which documents NTU publishes a URL for — so MF-IMPORTER-002 is a judgment
rule and its finding is `manual-review`, shown with its evidence for a person to resolve. Five of
the six current modules carry it, which is the intended pressure rather than a defect. Two of
the six documents behind it are the kind NTU publishes — a syllabus and a course guide — and
the rest are course-internal handouts that exist nowhere else, so the finding is expected to
clear about a third of the way and then stop.

**The unnumbering half is deterministic and fails.** A Definition's `evidence.<key>.source` and a
Task row's `provenance.source` are each one field whose whole value is the citation, so the audit
fails them exactly and names the repair. A Profile Evidence cell is prose by design —
MF-PROFILE-002 is a judgment rule — and pulling a path out of prose reliably enough to fail a
folder on it would be inventing the certainty this contract exists to keep out. The rule binds
the Profile; the auditor does not police it, and that gap is stated rather than papered over.

**An unnumbered citation is not always unique.** An importer root can hold two items whose names
differ only by their number, and the current cohort has such a pair of media-status notes and such
a pair of annotated slide decks. The register resolves a pair like that by checksum, which a
citation does not carry, so an unnumbered citation into one of them names both. That is a worse
pointer than a numbered one on the day the numbers are right and a better one on every day after:
the ambiguity is visible to a reader who opens the folder, and the renumbering failure is not.

**The contract version holds at 4.** A Definition citing a numbered path was conformant before this
and is not after, and that is deviation. `contract_version` gates a folder missing structure the
contract requires, which a transition installs one module at a time on the Owner's approval
(MF-TRANSITION-001). Moving the version here would mark every folder upgrade-required and hold
ordinary auditing behind that transition, to correct the text of a citation. MF-IMPORTER-002 adds
no structure a folder can lack at all.

## Revisit when

The importer offers a citation form it resolves itself, or a mirror that renumbers nothing. Either
makes the interior safe to cite and the ordering of these three worth reopening.

NTU stops publishing a document the first tier assumes — or starts publishing the handouts that
keep the fallback populated, which would empty it rather than change the order.

A Profile Evidence cell becomes structured enough to check — a distinguished pointer column rather
than prose — at which point the unchecked half of the unnumbering rule can be closed.
