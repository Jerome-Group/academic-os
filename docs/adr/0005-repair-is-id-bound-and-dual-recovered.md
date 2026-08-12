# ADR-0005: Repair is ID-bound and dual-recovered

## Status

Accepted.

## Context

Historical module repair renames, moves and retires real academic contents through a synchronised
Drive mount. A path can change between approval and execution, Drive calls can partially succeed,
and neither Drive Trash nor an ordinary Drive copy independently proves recoverability. Audit
observations contain metadata but are not backups.

## Decision

Repair is a separate capability from seed and audit. One approved plan binds the complete Drive-ID
inventory, current capabilities and versions, decisions, ordered operations and curation events.
The executor refreshes those preconditions and journals intent/result around every call. It has no
permanent-delete or Trash operation.

Before mutation, repair verifies two recoveries: an ID-mapped copy beneath a dedicated Drive root,
and a SHA-256 byte snapshot on a physically separate volume. Google-native files record their
export format; local-only artifacts record stable filesystem identity. The byte tree is read-only
and user-immutable on macOS, while documentation states that this is not WORM storage.
Approved local-only artifacts are independently rediscovered, identity-checked, journalled and
removed only after that verified byte recovery exists.

## Consequences

Repair costs time and temporary storage proportional to a module. Interrupted work can reconcile
tagged Drive operations and resume without guessing. An operator must provide full-Drive OAuth only
for repair, an external snapshot root and explicit approval of the exact plan; audit remains
metadata-read-only.
