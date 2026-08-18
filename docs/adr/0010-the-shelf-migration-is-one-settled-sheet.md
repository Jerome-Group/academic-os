# The shelf migration is one settled sheet, and its only write to the shelf is a rename

The one-time migration that brings an existing Textbook shelf into the system is approved through a
single artifact: a review sheet the sweep writes and the Owner settles. Nothing else is an
approval. The sheet carries one line per unindexed book — its filename, its checksum and its Book
key — and the settling questions ride as comments beside the lines that answer them, so the Owner
reviews the thing they are approving rather than a report about it.

The Book key on the line is authoritative rather than a suggestion the migration re-derives. A
default the sweep derived and a qualifier the Owner typed then read the same, which is what makes
the sheet a complete account of what the index will hold; re-deriving would mean the index could
disagree with the page the Owner signed off. A blank key is unsettled and blocks, because the
alternative — falling back to the default — is the tool answering the one question the review pass
exists to ask.

Everything the migration disagrees with is a **blocker**, not a throw. One preview names all of
them at once, so the review stays the single pass #72 designed rather than one round trip per
problem. Preconditions are re-read rather than trusted: the shelf is listed and every book in the
sheet is checksummed again at plan time, and a shelf that has moved under the review — a book
arrived, a book left, a copy was replaced — refuses the whole run in favour of a fresh sweep.
Paths are evidence here, not identity, and a mounted shelf has no identity to hold instead.

The only write the migration makes to the shelf is a **rename**, and it refuses a target anything
on the shelf already carries. `rename(2)` would replace that file silently and a replaced book does
not pass through Drive Trash, which makes overwriting the one loss on this shelf that no recovery
path answers. A rename whose target another approved rename is vacating is refused too rather than
ordered: ordering them is machinery a one-time pass would carry forever, and the Owner moving one
book by hand and sweeping again costs a minute. Renames run before the index because the index
records final filenames, and each is journalled either side of the call, so a run that dies
mid-pass leaves the list of books that actually moved rather than the list that was planned.

`docs/agents/safe-drive-testing.md` requires that mutation use Drive IDs rather than paths, and
this pass has none to use: it runs at the mounted tier the seeder and auditor already run at, where
Drive for Desktop offers a filesystem and no ID surface. That requirement is not waived so much as
paid in the currency available — the sheet pins every book's **sha256**, which is a stronger
identity than an ID because it names the bytes rather than the container, and the plan re-reads
every one of them against a fresh listing before a single rename. What the ID rule protects against
is mutating the wrong object; what protects against it here is that a book whose bytes moved, whose
name moved, or whose neighbours moved refuses the entire run.

## Consequences

The sweep refuses to overwrite an existing sheet: from the moment it exists the sheet is the
Owner's working copy, and a second sweep would discard every key they had settled on it. Recovering
from a shelf that moved therefore costs re-typing the qualifiers — few, by construction, and the
second sheet is the shorter one.

The sheet names the Owner's own books, so it lives in private state, never in a module folder and
never in this repository.

`Icon\r` — the file Finder leaves beside a custom folder icon — joins dot-files as something the
shelf reader does not see. **ADR-0009** has anything on the shelf that is not a cleanly named PDF
parking on every run "until the Owner deals with it — that is the intended pressure", and that
decision stands unchanged; what this settles is the prior question of what counts as being *on the
shelf* at all, which that record already answered for dot-files and answers the same way here. The
pressure is well aimed at a book, and cannot land on this file, because there is nothing for the
Owner to do: Finder writes it back whenever the folder icon is set, so the park would never end,
and a shelf that can never park nothing can never hand the daily catch-up the clean baseline this
migration exists to produce.

## Revisit when

A shelf arrives that cannot be settled in one pass — enough renames chained through each other that
refusing to order them stops being a minute's work.
