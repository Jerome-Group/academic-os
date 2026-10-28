# Tasks, Calendar and Operations

The CLI and Operations server read and update target-specific Tasks and Calendar state, with explicit proposals and verified refresh.

## Sub-features

- Task list provisioning, verified generation receipts and exact-plan operations preserve Module or Research-project identity.
- Guarded MCP compatibility names negotiate task-plan/1; current clients obtain read snapshots and retain exact operation IDs.
- Versioned Task recovery history and preview/apply recreation use isolated provider fixtures; interrupted sends retain exact source claims and snapshot references.
- Private lifecycle decisions prevent source-occurrence resurrection; native timing contract fixtures refuse missing/unsupported evidence.
- Synthetic Calendar setup checks exact owner access, preview and idempotent role binding. Refresh retains per-calendar stale data and tombstones.
- Proposal and promotion reassess one exact mutation plan, ownership and relevant availability; recovery authorizes only an exact accepted prefix.
- Calendar proposals cover academic timetables, Routine migration, recurring edits, cancellation and restoration.
- Research-project milestone proposals require explicit evidence status and a verification Task for provisional claims.
- Operations serves structured task tools through HTTP and enforces its listening-address boundary.
- Scheduler installers preview jobs and replace only their owned LaunchAgents.

## How to get to it (user POV)

Use the index's Tasks, Calendar, Operations and schedule entries.
MCP task tools require a configured Operations server and exact target.

## Driving it with the compiled CLI

Preconditions: the parent skill's build and fresh doctor succeeded. Provider fixtures and temporary launchd homes isolate external effects.
The HTTP fixtures require IPv4 and IPv6 loopback TCP access.

```sh
node dist/src/cli.js capabilities verify --workflow services --json --log "$aos_proof/services.json"
```

Require a passed outcome. CLI journeys preload fake Google providers at the production adapter boundary and assert stored provider state and refreshed files.
They cover task mutations, Calendar proposal/promotion and failure handling.
Calendar journeys also assert nonmutating timetable/Routine previews, later recurrence conflicts, new blockers after preview, owner revalidation and Research-project milestone evidence refusals.
Accepted writes require exact normalized content and identity; omitted/regular default event types are equivalent, while mismatches still refuse.
Receipt process fixtures cover competing and killed owners across duplicate-read, append and sync boundaries without PID takeover. This coordinates receipts, not all provider mutations.
Operations journeys open an owned temporary HTTP listener, call it and close it.
Scheduler journeys use a recording launchctl adapter and inspect the plist, replacement order, rollback and retained recovery bytes.
The installer-to-morning-runner PATH journey belongs to maintenance.

## Gotchas

Busy recurrence checks require complete finite supported DAILY/WEEKLY expansion in UTC or Singapore; unsupported rules, zones or exhausted bounds refuse.
Cancellation, transparent milestones and occupancy-preserving edits are exempt from busy expansion. Routine recurrence warnings cover the anchor only.
Restore covers the retained writable resource, without unavailable exception replay. Google observation/write races remain possible.
Synthetic Google state does not establish real authorization, account data or live service availability. Native timing remains an unactivated separate contract; configured dated/timed writes refuse until its adapter is verified. Client tool-schema migration and real native placement acceptance remain deployment prerequisites.
The temporary HTTP service uses an injected echo tool. Task tools have separate domain tests.
This does not prove the production resident server against Google.
In the known TCP-denying repository sandbox, `ACADEMIC_OS_REPOSITORY_FIXTURE_TRANSPORT=unix` selects Unix sockets and asserts default TCP fails with `EPERM`.
Record that narrower transport evidence. Do not use the override on a normal host to bypass a failure.
Real launchd installation, Tailnet reachability and scheduled host PATH require an authorized macOS-host pass.
Interactive `credentials authorize` and `calendar local setup` have no synthetic journey. `calendar setup` does.
Live Tasks, disposable Calendar, resident Operations and native scheduler journeys require their own scoped targets, readback and cleanup evidence. Retain dated live observations separately from general fixture coverage.

Task recovery fixtures prove historical capture, retention, guarded recreation, completion preservation and new-ID reconciliation. They prove neither native scheduling recovery nor an independent storage-disaster copy. See [Task recovery](../../../../docs/task-recovery.md) for approved operator conduct.
