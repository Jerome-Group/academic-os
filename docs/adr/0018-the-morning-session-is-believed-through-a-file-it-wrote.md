# The morning's session is believed through a file it wrote, and its exhaust is named by the day

The 06:00 routine runs one headless session per cohort module and has to say, in a fixed format,
what each one did. Two ways to learn that were open, and this record takes the second.

## The transcript was the obvious source, and it is the wrong one

A headless session prints as it works, and the wrapper already captures that stream. Reading the
morning out of it costs nothing extra — no instruction to the session, no second artifact — and it
is what the run produces whether or not anything asks for it.

It is also a **format the session does not owe anyone**. What a transcript contains is the model's
prose plus whatever the harness decides to interleave, and both move without notice. A report built
by scraping it is a parser held against a surface with no contract, which fails in the direction
that costs most here: a morning that scrapes badly reads as a quiet morning, and a quiet morning is
precisely the signal the Owner acts on by doing nothing.

So the session writes `result.json` — six named buckets, one per thing the report has a line for —
and the wrapper believes that file and nothing else. The prompt's last step is to write it, whatever
happened, so a pass that broke reports what broke.

## What this costs

**A session that dies before its last step reports a failure, not the work it did.** The transcript
of that pass is on disk beside the result and can be read by hand, but the morning's report will not
mine it. That is the trade taken deliberately: the report claims only what a session claimed, so
every line in it is something an agent said on purpose.

**The result file is a shape the prompt has to carry**, which is instruction the module folder could
not supply — the folder holds the procedure, not the wrapper's reporting contract. The prompt stays
the one place that shape is written, and the parser refuses anything else rather than filling gaps.

## The exhaust is named by the calendar day, which is what makes the purge safe

The routine keeps its own artifacts on the mini — session directories for seven days, reports for
thirty — and purges them itself. A retention window that deletes is only as safe as the set it can
reach, so the store that holds these has **no vocabulary but the day**: it lists the entries under
its two roots whose names are calendar days, and every path it builds is built from one. A file the
Owner drops beside them is not a day, so it is not listed, so it cannot be purged.

The day itself is the offering's, per
[ADR-0012](0012-a-date-is-a-calendar-day-and-a-stamp-is-cited-unread.md) — a 06:00 Singapore firing
sits eight hours ahead of the instant's UTC half, and naming the morning from the wrong one would
put two mornings in a day twice a month.

## Consequences

The report's six per-module buckets, the result file's six keys and the prompt's six-key example are
one shape stated once in each of the three places it has to appear; changing what a morning records
is a change to all three, and the parser's tests are what catch the third being missed.

Nothing reads a session transcript programmatically, so the log beside each result is evidence for a
human and free to change format.

## Revisit when

The Codex CLI gains a structured-output contract it commits to. That would make the transcript a
surface with a shape, and the argument above is entirely about it not having one.
