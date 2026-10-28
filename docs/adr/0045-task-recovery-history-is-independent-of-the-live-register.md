# ADR-0045: Task recovery history is independent of the live register

- Status: accepted
- Date: 2026-10-28

## Context

A current Task mirror cannot recover a prior title or completion state after refresh has accepted a live edit. Existing register-byte backups preserve local bytes, and operation journals preserve intent, but neither supplies an indexed historical provider observation or a targeted recreation workflow. Google deletion propagation must remain truthful without destroying the independent recovery source.

## Decision

Extend the existing refresh and exact-plan execution paths with private, versioned Task recovery snapshots. A verified capture precedes register publication and each new configured provider operation. Capture failure refuses publication or sending. Original register-byte backups remain separate, preserving YAML annotations that the typed Task history does not represent.

Snapshots retain allowlisted provider fields, target/list identity, local provenance, stable source-occurrence evidence, lifecycle state and operation receipt references. They are historical observations, never the current authority. Checksummed, synced publication makes incomplete captures ineligible for restore. Canonical private storage remains outside Drive and the public repository; default retention bounds verified history to 90 days, 512 versions and 64 MiB globally. Unresolved operations pin their snapshots; storage pressure then refuses additional work instead of erasing recovery evidence.

Targeted restore recreates one missing exact identity through a separately approved task-restore/1 plan. Fresh full-list and lifecycle preconditions, original/canonical/verified-alias checks and conservative duplicate detection precede sending. Existing provider Tasks are never overwritten. Owner dismissal always refuses; completed history cannot reopen a completed occurrence. Creation retains completion state and local provenance, records a new provider identity and refreshes the normal register while retaining its old cancelled row.

Durable intent and a source/old-ID claim precede creation. Lost creation identity remains unresolved without resending. Known-ID retries verify live state and finish local reconciliation without another create. Preview observes and reports without applying the mutation. New provider IDs are mappings, not restored Google history.

Native scheduling requires independently observed exact Task identity, surface, timezone and timestamped evidence. Public Task due dates cannot establish start, end or duration. Configured capture currently records native timing as unavailable; restoration requires explicit acknowledgement of this limitation and refuses dated, timed, described or hierarchical Tasks that its adapter cannot faithfully recreate. Projection IDs and native Task IDs remain distinct. Contradictory clock observations are evidence to resolve, never a fixed offset to apply.

## Consequences

The existing 30-minute pull job establishes current coverage without another scheduler or write authority. Intermediate manual UI changes that were never observed, pre-install history and unavailable native fields cannot be reconstructed. Private local snapshots protect against propagation and application errors; they are user-owned files rather than WORM storage or an independent disaster-recovery copy. Existing original byte backups and operation journals retain their separate cleanup obligations.

The exact-plan protocol and existing Module/Research callers remain compatible. Recovery is an explicitly invoked local CLI workflow; it creates no additional public tool or sharing surface. Rollback restores the previous source/build and existing services while retaining recovery files and journals; it never rewinds live Tasks or lifecycle evidence.
