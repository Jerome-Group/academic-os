# A date is a calendar day, and a rewritten stamp is cited unread

Two rules, and the second is why the first stopped being urgent.

**A date a module folder records is a calendar day in the offering's timezone** —
`Asia/Singapore` for an NTU offering — written `YYYY-MM-DD` and carrying no zone marker. That is
what a Definition's `checked_at`, a Task row's `do_date`, a curated name's date token and every
date in a Profile have always meant; it is now what they say.

**A value a tool rewrites on every run is cited by naming its file, never by transcribing it.** A
Profile Evidence cell for an NTULearn mirror points at `NTULearn/Last synced.md` and stops there.

What forced both: the Offering table's Status row reads `Current NTULearn course, synced <date>`,
and the edit that would refresh that date faced a stamp holding `2026-08-19T21:00:22.986Z`, which
at UTC+8 is the morning of the 20th. Two independent verifiers read that cell and reached opposite
answers. The scheduled sync runs at 05:00 local, which is 21:00 UTC the day before, so every stamp
the cohort holds sits inside the eight-hour window where the two readings disagree — only a run
started by hand at another hour puts them back together.

## Why the day, and not the instant's UTC component

Every other date in these documents is a bare local calendar date, so a UTC-derived value among
them is the same-looking thing meaning something else — the failure a reader has no way to see.
And the documents describe a semester that runs on the offering's calendar: a teaching week, a
lecture, a submission. A day that is off by eight hours is simply the wrong day in the only
calendar the reader has.

The system had already made this choice everywhere else and had never written it down here.
`Asia/Singapore` is the Calendar's default timezone and its all-day milestones are timezone-free
([ADR-0006](0006-google-calendar-is-the-live-authority.md)); the LaunchAgent installer refuses a
Mac set to anything else; the dated research notes stamp themselves `(Asia/Singapore)`. Reading a
module control in UTC would have made module folders the one surface disagreeing with the rest.

What the choice costs is a conversion: a reader holding an instant applies the offset before
writing the day, so the instant on screen and the day in the document can name different dates.
That was the whole of the case for transcribing the UTC component, and the second rule is what
makes it rare — the conversion now arises only where an instant is genuinely being read, which is
the Curation register, whose lines say in their own text which kind of thing they carry.

## Why the stamp is not copied at all

The zone was the wrong question for that cell, which is how two careful readers could split on it:
whichever day had been written, the next night's sync would have made it wrong.

`Last synced.md` answers "did the run happen?" and is the one file the importer rewrites every run.
The importer's own ADR-0008 warns that a downstream consumer parsing it would turn its shape into a
compatibility surface it is not, and
[this repository's research](../research/ntulearn-importer-destinations-and-state.md) concluded
from that: **stat it for freshness at most; do not parse it**. Reading the day out of it is parsing
it — taking a dependency the importer declines to support, and pinning the result into a document
nothing updates.

MF-PROFILE-002 already kept per-file curation state, live task progress and session history out of
the Profile. A per-run stamp is that same kind of thing and the list had no word for it. What the
rule had not said is how the Profile holds such a fact instead: it cites the file, which leaves the
authority where it is, one open away, and correct on every day of the semester rather than on the
day the cell was written.

## Consequences

The Profile stops answering "when did the sync last run?" from its own text. That is the trade, and
it is the right way round — a reader who wants the answer opens the file that has it, instead of
trusting a cell that was true once.

Six held information edits across two modules of the current cohort are released, and the one
drafted to carry the date is not written at all: its value was the question rather than an answer
to it.

The rule reaches every fact of that shape, not only this stamp. A control cites the file behind any
value some tool owns and rewrites.

**The contract version holds at 4, and what it holds against is real.** A Profile whose Status row
carries a copied day was conformant before this and is not after. That is deviation: MF-PROFILE-002
is a judgment rule, the finding it raises is `requires-decision`, and a cell rewrite repairs it.
`contract_version` gates the other thing — a folder missing structure the current contract
requires, which a transition installs one module at a time on the Owner's approval
(MF-TRANSITION-001). Moving the version here would mark every folder upgrade-required and hold
ordinary auditing behind a per-module transition, to correct a sentence in a table cell.

## Revisit when

The importer publishes a durable run report with a shape it supports; its ADR-0008 anticipates one.
Citing a stable published value is a different question from transcribing a stamp, and this record
answers only the second.

A module folder holds an offering that does not run on `Asia/Singapore`. The zone is a constant
here because every offering is NTU's, and an exchange semester would make it a Definition field.
