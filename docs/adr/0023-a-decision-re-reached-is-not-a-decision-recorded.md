# A decision re-reached is not a decision recorded

The importer rewrites `NTULearn/Last synced.md` on every run. New bytes at a known path is an update
arrival, so the walk decides the item again, reaches the `source-only` it reached last time, and
appends a superseding line saying so. Nothing is malfunctioning: the procedure is being followed
exactly. The vocabulary simply had no way to say *this file's content is the importer talking about
itself, and its changing is not news*.

The cost is measurable. Thirty-five such lines across six modules after two weeks; all eight of the
2026-08-26 report's supersessions, cohort-wide, were that one file. `Superseded` is therefore never
empty, so a reader comparing two mornings sees movement in it every day and has to look to discover
it means nothing — which is the property a report bucket exists to have.

**An update arrival a walk decides `source-only` again appends no line.** Supersession records that
a decision *changed*. A `source-only` line says the item stays in the mirror and is read there, so
writing it a second time records only that bytes moved — and the register is read top to bottom to
reconstruct a module's precedent, which a line adding none does not serve.

## The scope is one decision, not the file's name

`source-only` is the whole of it, and naming the decision rather than a property of it is deliberate.
The first draft scoped the rule to a decision that "placed nothing and derived nothing", which reads
`requires-decision` into it and — under a blanket opening sentence — reads `rederived` in too. Both
are wrong. Every decision but `source-only` records something the arrival changed:

- a `curated` line's copy was replaced, so the register would otherwise claim a destination holds
  bytes it no longer holds;
- a `rederived` line's artifacts were worked again against the new content, and the standing
  `derived` list and checksum would go stale unread;
- a `requires-decision` line's evidence is *this* arrival's — the ambiguity the Owner is asked to
  settle is about the bytes that just landed, not the ones before them.

A `source-only` line records none of that. It says the item stays in the mirror and is read there,
which is as true of the new bytes as of the old.

Naming the sync stamp instead was the tempting alternative, and it does not hold. The distinction
the ticket reached for — the importer's own bookkeeping against the material it carries — is already
in the contract as the **landmark** set, and that set is `Course.md`, `Last synced.md` and
`Announcements/` together. It cannot single out the sync stamp, so reusing it as the discriminator
would have reached the other two anyway. An allowlist of one name would need extending the first
time the importer adds a bookkeeping file, and the live mirrors already hold three more that churn
the same way.

**This reaches further than the sync stamp, deliberately.** Every `source-only` item stops
re-recording an unchanged decision — including ones no importer wrote, such as the earlier issue
MF-CURATION-004 leaves `source-only` when a reissue takes the curated name. That is the same answer
for the same reason, and the item is still *decided* every morning; only the writing down stops.
The ticket scoped out "any other importer-written file … decided as they are today", and they are:
what changes is not any decision but whether an identical one is written twice.

## The stamp's checksum goes stale, and that is the price

The join reads *path and checksum both known* as already decided. A standing line whose recorded
checksum is the bytes from three syncs ago no longer matches, so the sync stamp reads as an update
arrival every morning and is decided again — silently, appending nothing. The work is a hash and a
lookup, and it buys the alternative's absence: refreshing the checksum would be a line, which is the
thing being removed.

The staleness costs nothing else because the decision placed nothing. A `curated` line's checksum
anchors the standing-divergence walk and identifies the item; a `source-only` line's anchors
neither.

## The sync stamp is `source-only`, and its content is not rederived

One module's register says otherwise, and that is the second half of what this record settles. A
pass there decided the stamp `rederived`, naming `00 Module Admin/00 Module Profile.md` in `derived`
— *"The current mirror sync instant was incorporated into the Module Profile"* — and that became the
module's standing precedent, followed twice more since.

MF-PROFILE-002 forbids exactly this: *"Where a fact lives in a file some tool rewrites every run,
the Profile cites the file rather than a value read out of it: an Evidence cell names
`NTULearn/Last synced.md`, because a day copied out of it is stale by the next sync."* That module's
Profile now carries a sync date copied out of the stamp, and it was already two days stale when this
was written.

So the precedent is not merely noisy, it is wrong, and it costs more than a register line: following
it rewrites the Module Profile on every sync, and a module doc write raises the day's issue. Stating
the stamp's decision here is what retires it — precedent is the unattended pass's only resolver, and
a precedent is displaced by a rule rather than argued with at 06:00.

## The stamp stays citable

Nothing here touches the landmark. A control still cites `NTULearn/Last synced.md` under
MF-IMPORTER-001, and the standing `source-only` line stays exactly where it is, so the register
still records that the item was seen, decided, and left in the mirror. What stops is the second copy
of that sentence.

## Consequences

`Superseded` becomes a bucket that means something: movement in it is a decision that changed. That
is the point, and it is also what the Owner loses — a morning where an importer rewrote a file and
nothing about the module changed now reports nothing at all, where before it reported a line. That
is the trade [`0021`](0021-a-note-is-told-and-a-park-is-settled.md) made when it gave a note a bucket
that wakes nobody, and the reasoning is the same: a fact repeated every morning until the line itself
is the noise has stopped being a fact anybody reads.

**The existing lines stay.** The register is append-only history, and thirty-five lines recording
what was decided on the days they were decided are exactly that. Nothing rewrites them, and a walk
reading top to bottom still reconstructs the precedent correctly, because the standing line is the
last one either way.

**The cohort's pinned copies do not carry the rule until a `pinned refresh` runs.** Until then a
pass reading only its own folder keeps appending, and — in the one module — keeps rederiving into its
Profile. That is the operator step this record ships with rather than a caveat on it.

## Revisit when

An importer arrives that rewrites a file whose changing *is* news while the decision about it stays
`source-only` — material the module reads in the mirror rather than curating, that genuinely differs
run to run. The answer then is a decision that says *read this again*, which is a fifth thing the
register would have to carry rather than a scope change here.
