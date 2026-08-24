# The morning believes a schema, not a transcript — and the pass gets the workspace and nothing else

The 06:00 routine runs one headless session per cohort module and has to say, in a fixed format,
what each one did. Two things had to be decided: what the wrapper reads, and what the unattended
agent is allowed to touch.

## The transcript was the obvious source, and it is the wrong one

A headless session prints as it works, and the wrapper already captures that stream. Reading the
morning out of it costs nothing extra and it is what the run produces anyway.

It is also a **format the session does not owe anyone**. What a transcript contains is the model's
prose plus whatever the harness decides to interleave, and both move without notice. A report built
by scraping it is a parser held against a surface with no contract, which fails in the direction
that costs most here: a morning that scrapes badly reads as a quiet morning, and a quiet morning is
precisely the signal the Owner acts on by doing nothing.

## The CLI already has the contract, so the model is not asked to keep one

The first shape of this took the obvious next step — instruct the session to write `result.json` as
its last action — and it was worse than it needed to be, because it made the report depend on a step
the session had to remember. `codex exec` takes `--output-schema`, a JSON Schema the **final message
is validated against**, and `--output-last-message`, which writes that message to a path the caller
names. Verified against the CLI before this was written: a schema-valid six-bucket result lands at
the named path, written by the harness rather than by the model.

So `MODULE_PASS_SCHEMA` is handed to the CLI, the prompt describes what the six lists *mean* rather
than restating their shape as a rule, and the wrapper reads the file the harness wrote. A malformed
result is no longer a thing a morning can produce, and `readModulePassOutcome` still checks what it
was handed, because a wrapper that believes an unattended agent checks the artifact anyway.

**What this costs.** A session that dies mid-work has no final message, so it reports a failure
rather than the work it did. The transcript of that pass sits beside the result and can be read by
hand, but the morning's report will not mine it. That trade is deliberate: every line in the report
is something an agent said on purpose.

## The pass gets the workspace and nothing else

The same first shape asked for `danger-full-access`, on the reasoning that a pass writes into its
module folder on the Drive mount *and* its result under the private state root, which the
configuration forces outside that mount — two roots no workspace sandbox spans.

Having the CLI write the result removed the second root. Everything the *model* writes is interior
to the module folder: MF-IMPORTER-001's importer roots are directories inside it, the registers and
`docs/` are inside it, and the Teaching workspace is inside it. So the sandbox is `workspace-write`
with the module folder as the workspace — the narrowest thing that can do the job, for the one agent
here that runs every day with nobody watching.

It is stated on the command line rather than inherited from `~/.codex/config.toml`, for the same
reason the model and the reasoning effort are: a machine's configuration is not this system's, and a
morning's behaviour should not change because something else on the mini was retuned.

## The exhaust is named by the calendar day, which is what makes the purge safe

The routine keeps its own artifacts on the mini — session directories for seven days, reports for
thirty — and purges them itself. A retention window that deletes is only as safe as the set it can
reach, so the store that holds these has **no vocabulary but the day**: it lists the entries under
its two roots whose names are calendar days, and every path it builds is built from one. A file the
Owner drops beside them is not a day, so it is not listed, so it cannot be purged. Codex's own
rollout files under `~/.codex/` are not the routine's and are never touched.

The day itself is the offering's, per
[ADR-0012](0012-a-date-is-a-calendar-day-and-a-stamp-is-cited-unread.md) — a 06:00 Singapore firing
sits eight hours ahead of the instant's UTC half, and naming the morning from the wrong one would
put two mornings in a day twice a month.

## Consequences

`MODULE_PASS_SCHEMA` is the single statement of what a morning records; the report's six buckets and
the parser follow it, and the prompt points at the meanings rather than repeating the keys.

Nothing reads a session transcript programmatically, so the log beside each result is evidence for a
human and free to change format.

Stdin is closed for every session. `codex exec` reads it for additional instructions, and an open
pipe with nothing coming holds the pass — and the cohort behind it — until the timeout.

## Revisit when

A curation pass turns out to need a path outside its module folder. That would be a change to
MF-IMPORTER-001's shape rather than to this routine, and the sandbox is the place it would surface —
loudly, as a failed pass, which is the right way for it to surface.
