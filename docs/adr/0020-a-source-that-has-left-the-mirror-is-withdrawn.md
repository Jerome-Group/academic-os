# A source that has left the mirror is withdrawn, and the copy it placed stays

A curation register's standing line names a source in the importer mirror. When upstream renames
that page or deletes it, the walk meets nothing that answers to the line, and until now the register
had no way to say so. The item was surfaced as a discrepancy every morning, identically, for ever —
a park nobody could clear, which is exactly what
[`0010`](0010-the-shelf-migration-is-one-settled-sheet.md) settled must not exist, and what
MF-CURATION-002 quotes it for.

Unnumbered identity does not rescue it.
[`0019`](0019-register-identity-migrates-by-superseding-and-decides-nothing-else.md) strips the
`NN ` ordering prefix so an item that moved from one position to the next is not "reported as a
missing source for ever", and it names that phrase as the failure mode to design against. A rename
changes the words behind the number, so both halves of the identity differ and the join fails
anyway. The gap was never the key; it was that the vocabulary had no decision for a
source that is gone.

`withdrawn` is that decision, at register `schema_version` 3.

**It closes the source and says nothing about the copy.** MF-CURATION-002 has guaranteed since
contract v4 that a disappeared source does not delete its curated copy, and a withdrawal is that
guarantee written down rather than an exception to it: the copy stays exactly where the decision put
it. So a `withdrawn` line names no `destination`, no `derived` and — the load-bearing one — no
`supersedes`. Superseding the line that placed the copy would take the record of where the item went
off the top of the register, and a reader reconstructing the module's precedent would find a closed
item and no account of what it produced. The placing line stays standing history; the withdrawal is
the newer fact about the source alone.

**A withdrawal rests on a walk that completed over every declared root.** This is the safety that
matters, and it is not the same question as whether one file is missing. An importer that half-ran
or a root that would not read leaves a mirror missing sources the site still holds, and a pass that
withdrew them all would close a module's history on the strength of a failed sync — irreversibly, in
an append-only file, unattended, at 06:00. A walk that could not finish reports a failure and
withdraws nothing.

**Many standing sources gone at once is an ambiguity to park.** The completed-walk rule catches the
failure a walk can see; this catches the one it cannot. An importer can finish cleanly against a
truncated fetch, and the only signal left is the shape of the result: one departure is a page being
renamed, and a handful together is the mirror rather than the material. Park them with the count and
the roots they sit under, and let the Owner say which it was. The asymmetry is deliberate — a park
too many costs a morning's question, and a withdrawal too many costs a module's record.

**Precedent governs it as it governs every other decision.** The first withdrawal in a module is
unprecedented, so it parks and the Owner rules; their ruling becomes the line's evidence and the
precedent later departures read. That is what turns the daily park into a park the Owner clears
once, and it needs no new machinery — the seeded procedure already resolves by precedent and parks
where there is none.

**A source that reappears is a new arrival.** The withdrawal closed the item, so the join no longer
answers for that path and the file is classified from scratch. Reopening the old line instead would
mean the register had to model a resurrection, and the register's whole shape is that the newest
line about an item is what stands.

## Consequences

The register gains a fifth decision and the morning report a seventh bucket. A module's arrival
walk now ends every standing line it cannot meet, so the discrepancy that used to recur becomes one
question asked once and a line appended once.

Version 3 is what a new line carries; version 1 and version 2 lines stay history exactly as they
stand. That is `0019`'s rule applied unchanged — not rewriting a line is not a licence to write new
ones under a version the vocabulary has moved past — so the identity migration's superseding lines
carry 3 from this record forward.

The identity migration stops planning anything for a withdrawn item, including counting the legacy
lines behind it. Those lines are closed history: reporting them would have the run claim work
nothing will ever do, and exit clean while saying so.

Every module's copy of the Curation Procedure is stale until `pinned refresh` rewrites it, so the
cohort follows the four decisions until that has run — `docs/operator-guide.md` § **Pinned refresh**
is the step.

## Revisit when

A module needs to record that a source left and its copy should go too — material issued in error
and retracted, say. That is a decision about the module's own material, which is a second decision
rather than a field on this one.
