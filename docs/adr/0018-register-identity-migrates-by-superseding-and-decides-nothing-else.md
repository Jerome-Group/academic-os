# Register identity migrates by superseding, and the pass decides nothing else

A Curation register holds lines from before contract v4 keyed by Drive file ID and an md5, beside
lines an arrival walk wrote under v4 identity — the unnumbered source path and a sha-256 the pass
computed. A legacy line matches a v4 walk on neither half of that identity, so every morning the
item reads as a fresh arrival, is decided again, and is written back with v4 identity. The effect
is self-limiting and expensive in exactly the wrong place: an unattended agent rediscovering a data
migration a few items at a time, for as long as the legacy lines last.

`curation migrate` is the previewed pass that finishes it, and this record settles what it may do.

**It appends; it never edits.** A migrated item gains a line carrying v4 identity, the decision and
destination of the line it supersedes, and that line's own identifier in `supersedes`. Nothing
already in the file moves. The register stays what the contract says it is — append-only history,
read top to bottom, from which the module's precedent is reconstructed — and the older line stays
readable as the decision that was actually made on the day it was made. Rewriting identity in place
would have been shorter and would have destroyed that: the file would then claim a sha-256 was
recorded on a date when no pass computed one.

**An item's standing line is the last line about it.** Both conventions are read for the one half
they share, the source path with the importer's `NN ` ordering stripped from every segment, and
that path is the key items are grouped by. This is what makes a second run over a migrated register
plan nothing: the standing line is now the appended one, and it already carries v4 identity.

**Identity is carried forward only where the bytes prove the decision still stands.** The pass
re-reads each source and compares it against the digest the standing line recorded, in that line's
own algorithm. Matching bytes mean the decision was made about the material still on the mount, so
it moves forward unchanged. **Differing bytes are an update arrival** — the source was reissued or
replaced — and what happens to it depends on whether the placed copy has been worked on since,
which is a question about the module's own material and therefore the Owner's. The migration leaves
that line exactly as it stands and reports it. A pass that silently rewrote it would suppress the
one re-decision that was genuinely owed, which is the opposite of the loop it exists to close.

The same restraint covers a source that has left the mirror and a line whose checksum this pass
cannot compare: both are reported and neither is touched. Nothing an arrival walk cannot meet is
touched at all — a line whose integration is not a declared importer root names something no walk
goes looking for.

**A new line writes the checksum notation its own register already uses.** `repair` wrote
`md5:<hex>`; the seeded Curation Procedure's example writes the digest alone. The walk joins on the
recorded string, so a register whose v4 lines are prefixed gets a prefixed line, and one with no v4
line yet gets the bare digest its procedure documents.

## Consequences

The register grows by one line per migrated item, once. That is the trade this record makes
deliberately: a bounded, reviewed append against an unbounded one written a few lines a morning.

The pass finishes with items still on legacy identity whenever their bytes have changed, and those
are the ones the next walk re-decides — once each, in the open, rather than every morning. A run
that has nothing left to migrate but is still holding such items says so with its own exit code
rather than reporting itself clean.

Every write proves itself under `docs/agents/safe-drive-testing.md` at the mounted tier: the
register resolves inside the Drive mount, it is an ordinary file, its bytes still hash to what the
preview read, and the whole proving pass finishes before anything is written. The sources are read
after the module is materialized, because an undownloaded Drive file reads as empty and hashing
that would record the checksum of nothing as an item's identity.

## Revisit when

An importer arrives whose mirror the pass cannot re-read — material behind an export rather than on
the mount — leaving identity that can only be migrated from what a listing claims rather than from
the bytes themselves.
