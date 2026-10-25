# Google Calendar is the Live calendar authority

Query transitions and displaced recovery evidence are refined by
[ADR-0043](0043-calendar-refresh-binds-query-scope-and-retains-displaced-evidence.md).

Google Calendar is authoritative for which Calendar items actually exist and their current
details. Private configured storage holds an agent-managed Calendar workspace: a mirror of that
live state plus unpromoted Proposals. Humans edit the Live calendar; agents edit the workspace and
may Promote selected Proposals only during an interactive session.

An unattended Refresh is strictly pull-only from the Live calendar into the workspace. A new or
changed live item wins for live state, while a workspace-only item remains a Proposal until an
agent Promotes it. Refresh runs daily, before every interactive calendar session and after every
Promotion. A manual live deletion wins: Refresh removes the current mirror, retains a Calendar
tombstone and marks any dependent Proposal stale rather than recreating the item.

Routine management begins at a configured current Management horizon and extends without a future
cutoff; past events remain only in Google Calendar. Refresh uses provider incremental-sync tokens,
records deletions, and falls back to a full forward sync when a token expires. Each calendar
publishes atomically: a failed calendar retains its last-good mirror and becomes stale, while
successful calendars advance. Promotion is blocked when stale state could affect the item or its
conflict check.

An explicit request to schedule, move or cancel one item authorises that exact Promotion.
Agent-generated or bulk Proposals require a preview and explicit promotion instruction. Every
Promotion rereads the resulting Google state before Refreshing the workspace. If live state
changed after a Proposal was prepared, the agent rebases or asks rather than silently overwriting
it.

Making the private state authoritative was rejected because ordinary Google Calendar edits are a
normal authoring path. Automatic bidirectional or last-write-wins synchronisation was rejected
because it could publish Proposals unattended or turn stale private state into live truth.

## Consequences

Exact schedules, provider identifiers, refresh state and Proposals stay outside this public
repository. The workspace must distinguish mirrored live state from Proposals and preserve the
latter during Refresh. No background process needs write access to Google Calendar; live mutation
is an explicit, verified agent-session capability. Scheduled Refresh uses read-only Calendar
authority, separate from the write authority available only to an interactive agent session.

The Google primary calendar is the **Academic** Owned calendar. **Commitments** and **Routine** are
secondary Owned calendars. Invited events remain on the primary calendar and may be privately
classified without duplication. Refresh mirrors invited events and conflict checks include them,
but `academic-os` never sends invitations, changes attendees, responds to invitations or edits
organiser-owned details; the Owner handles those interactions directly in Google Calendar. All
other visible selected calendars are Observed by default; hidden or unselected calendars are
ignored unless explicitly included. Observed event details are not persistently mirrored—only
temporary availability results support conflict checks.

Calendar-level defaults govern reminders, visibility, colour and availability. Owned calendars
default private; fixed Calendar events are busy; Calendar milestones and Routine events are
transparent. A known deadline time is a timed milestone; a date-only source remains all-day.
Recurring-series changes must explicitly select one occurrence, the whole series, or this and
future occurrences.

The initial Routine migration moves the complete existing recurring series for sleep, exercise,
showering, travel, meals and the personal daily standup from the primary Academic calendar. It
does not split series at the Management horizon: preserving recurrence and exceptions outweighs
reorganising their past occurrences, which remain outside routine management.

The daily Refresh runs locally at 05:00 Asia/Singapore and catches up after wake if missed. A
public CI runner never receives calendar data or credentials.

`Asia/Singapore` is the default timezone. Timed items retain their IANA timezone, including a
destination-local timezone when appropriate; all-day milestones are timezone-free. Refresh
mirrors a live item even when it appears categorically misplaced and emits only a Placement
suggestion. It never moves the item automatically.

Promotion patches only the intended fields and preserves descriptions, links, attachments,
attendees, reminders, recurrence exceptions, visibility and conferencing unless explicitly
changed. Private state lives beneath configured `stateRoot/calendar/` as atomic last-good mirrors,
separate Proposals, Calendar tombstones, per-calendar sync state and an append-only Promotion
journal. Tombstones retain last-known details indefinitely from the Management horizon; restoring
one is always an explicit Promotion. Restore recreates the exact normalized writable resource
retained in that tombstone with a new identity. A detached instance becomes a standalone event;
a recurring master recreates only that master. It does not promise unavailable exception replay.

Agents route Owned-calendar writes through one fast Promotion path: Refresh, preview the exact
diff, execute the authorised change, reread Google, append one journal entry and Refresh. A
Proposal binds the Google item version it was prepared against and is merely ready, stale,
promoted or abandoned; revising it replaces the current pending proposal while the small journal
preserves what was actually promoted. Google event and series IDs are the ordinary identity, with
a private idempotency key only for a not-yet-created item so retry cannot duplicate it. Imported
items retain source identity for deduplication.

Cancelling an Owned item deletes the explicitly selected event or recurring scope from Google and
retains its Calendar tombstone. Daily Refresh is silent on success; failure retains the last-good
mirror, marks the calendar stale and emits one local macOS notification. Placement suggestions and
stale Proposals wait for the next interactive session. An agent may report last-good state only
when it labels it stale and names the last successful Refresh; Promotion remains blocked until the
required calendars Refresh.

This is intentionally a small local calendar tool, not a workflow engine: no database, service or
general event-sourcing layer is implied by the safety rules above.

V1 has one agent-facing CLI and no separate human interface; humans continue using Google
Calendar. It configures the three Owned calendars, Refreshes plain JSON state, previews and
Promotes create, move, update and cancel operations, handles recurring scope, checks conflicts,
runs the daily local Refresh and migrates the existing Routine series. One JSONL file records
Promotions. Atomic file replacement is the entire persistence design.

V1 accepts concrete and source-backed academic-timetable Proposals prepared by the interactive
agent. The NTU AY2026-27 Semester 1 date map is public and source-backed; the personal timetable
manifest, exact event identities and Proposal state remain private. Refresh stores recurring
masters and exceptions rather than materialising every occurrence; timetable Proposals expand
their bounded semester occurrences only for conflict checking. Calendar colours carry
classification, existing reminders are preserved and new items inherit calendar defaults; V1 adds
no per-event colour policy.

Bootstrap binds the Google primary calendar as **Academic**, reuses or creates **Commitments** and
**Routine**, and stores their exact IDs privately; later operation never guesses identity from a
calendar name. Conflict checks derive intended occupancy from the exact write plan, adding travel
buffer only when the Proposal supplies one.

## Complete availability and recovery

Preview and every additional Promotion write use one assessor. It resolves the actual
master, instance or immutable future boundary, compiles the exact payloads and exception actions,
then checks intended occurrences against each other and live availability from all Owned and
selected visible Observed calendars. The transport writer executes that plan without choosing
another anchor, remaining count or replay action. Stored intervals, digests and calendar counts
are display evidence; they cannot authorize a write.
Each preview and every additional write requires current exact `accessRole: owner` for all three
configured Owned calendars. Missing, malformed or weaker access refuses; an old workspace role
binding cannot authorize a formerly owned calendar. Selected Observed calendars can remain readers
and supply availability without becoming write targets.

Busy recurrence coverage supports one DAILY or WEEKLY RRULE, positive INTERVAL, finite COUNT or
inclusive UNTIL, weekly nonordinal BYDAY/WKST and supported EXDATE values. COUNT counts base
positions before exclusions or cancelled instances. RDATE, other rule parts, uncertain exception
remapping and exhausted occurrence, iteration or provider-page budgets refuse the whole operation.
There is no implicit future cutoff. Complete source inventory, including sparse cancellations,
uses paginated stored-resource reads without the mirror's Management horizon when absence or
mapping matters. Future scope preserves prefix events by original identity; an actual start moved
across that boundary does not change its membership.

Singular timed boundaries use exact offset instants. Recurrence and busy all-day conversion support
UTC and Asia/Singapore, with Singapore local dates from 1982-01-01 onward. Each generated start/end
must agree with installed Intl timezone data; the review binds the expansion engine, ICU and
timezone-data versions. All-day ends are exclusive and use the actual calendar timezone. Other
zones or unsupported dates refuse a busy occupancy change. A timed offset expresses an absolute
instant; its declared zone determines the recurring wall time, including provider-normalized UTC
representations.

Cancellation, transparent milestones and structurally occupancy-preserving metadata writes do not
require finite busy expansion. Unbounded metadata edits remain supported when geometry, recurrence,
blocking policy and calendar conversion stay unchanged. Routine keeps its role-based warning
policy; recurring Routine warnings cover the anchor only and do not claim complete enumeration.
Malformed geometry still refuses before an exemption is applied.
Future cancellation uses the exact live provider instance's master and original-start identity
as its boundary; it does not enumerate an unbounded prefix. It trims RRULEs and removes known
future overrides. RDATE or unknown positive recurrence lines refuse before trimming because the
current cancellation plan cannot remove their future positions exactly.

Every unjournaled legacy Proposal requires re-preview. Version 2 review evidence binds intent,
originals, complete inventories where needed, the exact plan, coverage, calendars and relevant live
availability. Recovery accepts only the plan's exact original state or an exact accepted prefix,
including content and idempotency identity. Every remaining trim, move, create or replay reassesses
availability. A refusal preserves accepted effects and performs zero additional writes. Unknown
partial state requires reconciliation; a missing unrecorded cancellation cannot distinguish an
accepted delete from an independent deletion and therefore requires reconciliation too. Completed
receipts permit strict read-only verification and finalization, never repair writes.

Google provides no transaction spanning these observations and writes. Another actor can change
availability after assessment. Fixture checks establish the local request and recovery behavior;
real-account Calendar parity requires separately authorized live verification.

The CLI surface is `calendar setup`, `calendar refresh`, `calendar propose` and `calendar promote`.
Only `calendar promote <id>` mutates events. Setup previews any calendar creation before applying
it, and the initial Routine-series migration is one previewed Proposal rather than a special
command.

## Revisit when

Humans need to edit the private Calendar workspace directly, or unattended publication to Google
Calendar becomes a requirement.
