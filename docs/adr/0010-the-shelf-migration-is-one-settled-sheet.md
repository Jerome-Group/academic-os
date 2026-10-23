# The shelf migration is one settled sheet with independent book renames

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
The owner repeats those observations under one mutation lease. These checks establish the bytes
at the observation; they cannot atomically condition a later filesystem rename on a checksum.

The only change to a book is an **exclusive rename**, and it refuses an occupied target at the
native syscall. Ordinary `rename(2)` would replace that file silently and a replaced book does
not pass through Drive Trash, which makes overwriting the one loss on this shelf that no recovery
path answers. A rename whose target another approved rename is vacating is refused too rather than
ordered: ordering them is machinery a one-time pass would carry forever, and the Owner moving one
book by hand and sweeping again costs a minute. Renames run before the index because the index
records final filenames, and each is journalled either side of the call, so a run that dies
mid-pass leaves exact source, destination, identity and checksum obligations. An interrupted move
is observed from both names; it is never blindly repeated or rolled back.

`docs/agents/safe-drive-testing.md` binds this mounted tier. Drive for Desktop offers paths and
local filesystem identities, not Drive IDs. The sheet's **sha256** pins reviewed bytes; it does
not provide syscall-time content identity. Root, source or capture substitution after the final
check can still select another entry. Readback detects disagreement, reports partial work and
withholds the migration index batch. It does not undo an independent book move.

`openFileShelf` owns planning, book effects, index publication, readback and durable outcome.
Both commands and the daily prelude use it. One canonical per-Shelf private JSONL journal records
logical runs and unresolved intent. Same-host writers with the same canonical configured private
state root share its SQLite mutation ownership; the database stays outside Drive. Another device,
another state root, manual editors and sync clients do not share that coordination.

`00 Index.yaml` remains the one active Owner-editable catalog. Appends preserve YAML nodes,
comments, order, Owner division words and unrelated fields. A uniquely named hidden proposal is
written and synced on the Shelf, then exact publication intent is durably recorded. A fixed native
helper atomically exchanges an existing index with the proposal, or exclusively publishes when
the index was absent. It never falls back to ordinary replacement. Both names, raw hashes, final
books and the opened root are read back before success. A mismatch after exchange is partial work
with an index that may already be published.

The proposal name becomes a **permanent captured original** after an exchange, including after
success. A later write through an old open descriptor lands in that capture. Captures are recovery
documents, not another active catalog, and are never automatically merged, moved or aged out.
Each actual replacement retains one small YAML generation; failed runs may retain proposals and
exact owned capability-probe metadata. Reconciliation observes one recorded run. A proved applied
or unapplied run can be acknowledged by a later owner; genuine partial work fences further apply.

Actual appends require a C compiler and verified native exclusive, exchange and directory-sync
operations. An exact owned hidden metadata probe establishes them before any book moves. Preview,
ordinary builds and no-op daily runs need no compiler. Unsupported prerequisites refuse before book
effects. Linux and Darwin use their own native operations and require real runtime controls.

## Consequences

The sweep refuses to overwrite an existing sheet: from the moment it exists the sheet is the
Owner's working copy, and a second sweep would discard every key they had settled on it. Recovering
from a shelf that moved therefore costs re-typing the qualifiers — few, by construction, and the
second sheet is the shorter one.

The sheet names the Owner's own books, so it lives in private state, never in a module folder and
never in this repository.

Success describes the recorded observation. This protocol supplies no atomic checksum-conditional
movement, distributed or cross-state-root locking, automatic late-Owner-edit integration, or
preservation against arbitrary namespace/content substitution. Local filesystem tests do not
establish configured-mount, Drive propagation, power-loss or cloud recovery guarantees.

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
