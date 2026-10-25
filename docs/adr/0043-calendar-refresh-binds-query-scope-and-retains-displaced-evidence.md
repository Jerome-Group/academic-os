# Calendar Refresh binds query scope and retains displaced evidence

Refresh reuses an incremental token only for the same calendar ID, Management horizon and recorded
supported query shape. Missing query metadata requires a full read. A different binding rebuilds
the live collection and retains the displaced mirror as a private recovery snapshot under its
original identity. Persistence and byte readback of that snapshot precede replacement. Failure
refuses replacement.

This refines [ADR-0006](0006-google-calendar-is-the-live-authority.md). It supersedes that record's
claim that past events remain only in Google Calendar when an old observation survives in a
displaced recovery snapshot. Google remains the Live authority. Snapshots neither assert current
existence nor authorize restoration or Promotion. The active mirror still uses the configured
Management horizon.

[#393](https://github.com/Jerome-Group/academic-os/issues/393) reproduced an earlier horizon marked
fresh while missing an unchanged event, and full token recovery losing a cancelled invitation's
last-known details and access. The [primary-source research](../research/calendar-refresh-bindings.md)
establishes the query and sparse-cancellation boundaries.

Reusing tokens or relabelling retained state would misrepresent the collection. Clearing all old
evidence would lose recovery details. Refusing every reconfiguration would preserve evidence but
prevent routine horizon changes. One snapshot before displacement preserves evidence within the
existing atomic-file persistence design; no separate recovery workflow is introduced.

## Consequences

A failed refetch retains the old calendar ID, horizon, token, items, tombstones and last successful
Refresh, marked stale. Preparing a Proposal requires fresh state with the current binding.
Absence on a changed or undocumented query does not create a tombstone or imply deletion. A
same-binding full recovery still detects missing previously live items. Explicit same-calendar
cancellations retain last-known content and invited access independently of the rebuilt live
collection. Another calendar's history never supplies those details.

Private `stateRoot/calendar/mirrors/archive/` snapshots preserve displaced raw bytes, including
prior tombstones, indefinitely. They consume space when bindings change and may include observations
outside the current horizon. Normal incremental Refresh creates no snapshot. Snapshots are recovery
evidence for inspection under their original identity; this decision adds no automatic restore or
cleanup authority. Existing Proposal and Promotion checks remain authoritative.

## Revisit when

Binding changes make snapshot retention costly, or explicit cross-binding recovery needs its own
reviewed command.
