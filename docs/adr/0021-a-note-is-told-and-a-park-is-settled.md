# A note is told and a park is settled, and only one of them wakes the Owner

The module pass had one bucket, `parked`, for two different things: a question the Owner must
settle, and a fact about the module that is correct and will stay correct. Sharing a bucket made
every pass choose between waking the Owner over something already settled and staying silent about
something real — and two passes over identical, unchanged state chose differently.

One morning a module parked a placed copy that had diverged from its source, citing both digests and
the edited work the destination held. The next morning the same module reported nothing about it.
Nothing had changed; both files still hashed to exactly those digests. The second pass had not
missed it — its session log holds the discrepancy, a confirming hash of both files, deliberation,
and then an empty report. It also found a duplicate register key and a superseded line whose
destination no longer exists, and reported neither.

Both mornings were defensible readings of the same procedure. A diverged copy holds its ground; that
is the correct, settled outcome, so the second pass judged there was nothing to settle, and the
first judged the Owner should know. The vocabulary could not express the answer both were reaching
for, which is *this is true, and no decision is owed*.

`noted` is that answer: an eighth bucket on the pass's outcome, for an observation that is correct
now, stays correct, and asks nothing of the Owner.

## `noted` alone never raises the day's issue

That single asymmetry is the point of the bucket. `parked`, `docWrites` and `failures` each still
raise it, unchanged — a park is a question, an unwatched doc write needs review, a failure is work
that did not happen. A note is none of those, so a morning whose only news is a note stays a quiet
morning and the note waits in the report the routine writes anyway.

Without the asymmetry the bucket buys nothing. A note that raised an issue would be a park under a
new name, and the daily wake-up the pass was trying to avoid would come back with better wording.

**The report still renders `Noted` every morning, empty or not.** Not raising an issue is not the
same as not being written down: the fixed format is what lets a reader compare two mornings as the
same document, and a bucket that appeared only when it had entries would make a note's absence
unreadable.

## A severity field on `parked` was the smaller change and the wrong one

The obvious alternative is to keep one bucket and grade it — a `severity`, or a `settled` flag — so
the issue policy filters on the flag. It is a smaller diff and it fails on what the pass has to do
with it. The pass is the thing applying the distinction at 06:00 with nobody awake, and a flag on a
park asks it to record something as a question and then mark the question closed. Two lists ask it
the question it can actually answer: *does this owe the Owner a decision?* Park if yes, note if no.

The morning report is the second reason. A graded `parked` list renders as one heading whose entries
mean different things, and the Owner reading it has to filter by eye — which is exactly the work the
report exists to have already done.

## A note carries no evidence, because nothing is settled from it

`parked` carries `reason` and `evidence`; `withdrawn` carries the precedent that says its source is
gone. Both exist so somebody can settle something. A note is read and never actioned, so it carries
`item` and `note` and stops there — the note states its fact in full, digests and all, and a field
for settling it would be a field nothing ever settles.

## `noted` is a report bucket and not a sixth register decision

[`0020`](0020-a-source-that-has-left-the-mirror-is-withdrawn.md) added `withdrawn` as both a
register decision and a report bucket, because a departed source is a new fact about an item's
classification and the register is where classification lives. A note is not that. It reports what
the register and the procedure have **already** decided, so writing a line for it would append
history that changes nothing and give a future walk a decision to join against that decides nothing.
The register keeps its five decisions and its `schema_version` 3.

## Consequences

The pass's outcome carries eight lists rather than seven, and the count is duplicated across
`MODULE_PASS_SCHEMA`, `readModulePassOutcome`, `ModulePassOutcome`, `failedModulePass`,
`renderMorningReport`, `renderModulePassSummary` and the session prompt. A ninth bucket has to reach
all seven; the review of the seventh caught the terminal summary still counting six, which is the
copy with the least test pressure behind it.

**A quiet morning now means less than it did.** It used to mean the pass found nothing worth saying;
it now means the pass found nothing worth *asking*. The report on the mini is the only place a note
appears, so the Owner who reads nothing but issues will not see one. That is the trade the bucket
exists to make, and the report is the thing that makes it safe.

**The seeded Curation Procedure still says a worked-on placed copy parks.** Its update-arrival
clause reads *"Anything else — annotated, graded, edited, moved away — parks, and the placed copy
holds its ground"*, which is the conflation this record names, written before there was a second
bucket to write. The session prompt now routes that case to `noted`, so the morning reports it
correctly; bringing the pinned procedure into line is a change to `docs/module-folder-contract.md`
and a `pinned refresh` across the cohort, which is its own ticket.

## Revisit when

A note needs to stop being told — the same fact repeating every morning for a term, read and
re-read, until the line itself is the noise. The answer then is a way for the Owner to retire a
note, which is a decision about the register rather than a field on this bucket.
