# The shelf catch-up appends what a filename proves, and parks the rest

The daily Textbook-shelf catch-up writes a Shelf index entry for a new book only when the book's
filename carries every fact that entry records, and parks the book otherwise. Its whole input is
the shelf listing and the index: names it parses against the codified naming, bytes it checksums,
and nothing it opens or interprets. Three situations are parks rather than judgements — a name the
naming does not accept, a default Book key (the first author's surname) the index already holds,
and bytes already indexed under another name — because each is a decision the Owner makes once and
the tool would otherwise make daily.

The **Division word** is the fact this cuts hardest against. The index records how a book divides
itself — Chapter, Lecture, Part — in the book's own word, and no filename carries it, so an
appended entry has no `division` until the Owner reads it off the book. Defaulting it to `Chapter`
was rejected: the index is the authority every chapter filename is built from, keys and division
words are cited by files that then cannot be renamed, and a wrong word there is wrong in filenames
nobody can trace back. A missing one costs the first cut from that book a park, which the seeded
Textbook procedure already handles as ambiguity.

Writes are additive and the store has no other kind: it appends entries and offers no operation
that renames or removes one, because neither is the tool's to make. The index is edited in place
as a document rather than rewritten from a parsed value, so the Owner's ordering and comments
survive a catch-up that appends beneath them.

## Consequences

The shelf is configuration, not knowledge: `textbooks.shelfRoot` names it relative to the Drive
mount, like every semester root, so no path into the Owner's coursework is written down here.

Anything on the shelf that is not a cleanly named PDF parks on every run until the Owner deals with
it — that is the intended pressure, and it is why `Archive/` is invisible rather than merely
unindexed. A book renamed on the shelf parks as a checksum duplicate rather than moving its entry,
because the entry's filename is the Owner's to correct.

The one-time migration is what makes the parks rare: it settles collision keys and nonconforming
names before the index exists, so a routine catch-up afterwards has only genuinely new books to
consider.

## Revisit when

The shelf gains books whose filenames cannot be made to conform, or a Division word becomes
readable from a book without a human opening it.
