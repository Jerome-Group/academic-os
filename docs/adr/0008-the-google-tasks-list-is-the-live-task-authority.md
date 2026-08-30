# The Google Tasks list is the live Task authority

One Google Tasks list per configured Task target holds that target's academic work, and its
**persisted exact ID** is the list's identity — a title is how a list is adopted once and never how
it is resolved again. A target is a Module, or an active Research project under ADR-0024. Its Task
register (`00 Module Admin/30 Task Register.yaml` or
`00 Project Admin/30 Task Register.yaml`) is an agent-managed mirror of that list plus the
provenance Google cannot hold. The list is where tasks exist and where the Owner ticks them on a
phone; the register catches up by pull and never wins a conflict.

An unattended refresh is strictly pull-only and has no write authority at all. The live list wins
for every task Google knows. A task Google no longer has is marked `cancelled` in the register
rather than dropped, so a deletion stays legible and is never re-pushed. A register row not yet
pushed survives every pull. In-session writes follow the Calendar Promotion pattern — push, reread
the live result, refresh — and are a separate increment.

A Task carries one date, the **Do-date**: the day the work is planned. Google's `due` is date-only
by API contract, so the register schema reserves no room for a time anywhere. Deadlines stay
Calendar milestones, which carry times, and a register row may name the milestone it relates to.

GitHub Issues and Google Tasks never meet: Issues remain the semester's task list and this
repository's own work, Tasks holds Module- or Research-project-scoped academic work, and nothing
mirrors between them in either direction. A register is never a Calendar Proposal source; a
milestone becoming a task is an agent suggestion the Owner accepts in session.

Making the register authoritative was rejected for the reason ADR-0006 rejected it for calendars:
ticking a task on a phone is the normal authoring path, and a mirror that could overrule it would
make the phone lie. Resolving a list by its title was rejected because Google enforces no
uniqueness on titles — a second list named for the target would make adoption ambiguous.
Automatic bidirectional synchronisation was rejected because it would let an unattended run
publish to Google.

## Consequences

Credentials for the two Tasks scopes — `tasks.readonly` for the scheduled pull, `tasks` for
interactive writes — are minted by a fresh consent run into the Owner's private keys folder and
named by the gitignored config. Google offers no finer grain, so the write credential necessarily
covers every task list on the account and stays out of every scheduled job.

Module and Research-project folders stay code-free, clone-free and credential-free: their whole
task surface is the register file. The machinery lives here, and a folder agent reaches it as a
served operation rather than by cloning this repository.

A failed pull leaves that target's register untouched and reports it stale beside the targets that
refreshed, so one unreachable list never stops the cohort catching up. When a Module leaves the
monitoring cohort or a Research project becomes inactive, automation stops touching its list and
nothing deletes it; the register file remains in the target folder as the durable record.

## Revisit when

Google Tasks gains a time-of-day the API can read back, or unattended publication to a live list
becomes a requirement.
