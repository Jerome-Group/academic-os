# ADR-0030: Periodic state refresh preserves local task evidence

- Status: accepted
- Date: 2026-09-08
- Plan: [Academic workspace renewal](../research/academic-workspace-renewal.md), #227

## Context

Task pulls serialize typed provider fields, but a live register also carries human annotations and
local fields. Increasing the pull cadence without preserving them multiplies data loss. A pull can
also overlap a human edit or another operation. Daily Calendar refresh leaves the mirror stale
between sessions even when the provider is reachable.

## Decision

Preserve the existing YAML document and match rows by provider identity. Local unpushed rows retain
their exact known identity and extra fields. Preserve history; an unmatched existing row is a
conflict, not deletion authority. Validate the document before writing. Unchanged typed state keeps
the original bytes and modification time.

A store retains the bytes observed at read time through deferred resolution. Cooperating writers
use an exclusive private recovery lock; compare current bytes again before publication. Verify an
independent original backup and journal the intended digest first. Replace an existing file atomically or create a missing file exclusively, verify the
result and retain a completion record. Ordinary path and materialization checks protect the mounted
boundary. The filesystem offers no atomic compare-and-swap against an unrelated editor; the final
comparison narrows that race and the backup preserves recovery evidence.

A native 30-minute job pulls Calendar and Tasks independently with hard timeouts. Its private
status preserves last-success timestamps through failures. Notifications describe failure/recovery
transitions; healthy and repeated unchanged runs stay quiet. Keep morning curation separate, using
the Owner's selected Astra medium workload. Record one-time actionable source signals as parked
follow-ups until settled, so source classification cannot erase an outstanding action.

## Consequences

Task IDs, provider status and provenance retain their authority. The periodic job creates no live
tasks or events. Recovery files require deliberate verified cleanup and remain outside Drive and
the public repository. A failed or interrupted write is explicit, with its original retained.
Existing daily scheduling remains available for rollback; retire it only after verifying the new
installed job. Broader planning, inferred completion and automatic Research promotion remain human
session decisions.
