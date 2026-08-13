# Google Calendar is the Live calendar authority

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
one is always an explicit Promotion.

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

V1 accepts concrete Proposals prepared by the interactive agent. A simple source field preserves
room for later timetable, document or ICS adapters, but none are built now. Refresh stores
recurring masters and exceptions rather than materialising every occurrence; commands expand only
the bounded interval they need. Calendar colours carry classification, existing reminders are
preserved and new items inherit calendar defaults; V1 adds no per-event colour policy.

Bootstrap binds the Google primary calendar as **Academic**, reuses or creates **Commitments** and
**Routine**, and stores their exact IDs privately; later operation never guesses identity from a
calendar name. Conflict checks inspect the proposed interval, adding travel buffer only when the
Proposal supplies one.

The CLI surface is `calendar setup`, `calendar refresh`, `calendar propose` and `calendar promote`.
Only `calendar promote <id>` mutates events. Setup previews any calendar creation before applying
it, and the initial Routine-series migration is one previewed Proposal rather than a special
command.

## Revisit when

Humans need to edit the private Calendar workspace directly, or unattended publication to Google
Calendar becomes a requirement.
