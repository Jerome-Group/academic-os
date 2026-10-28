# Task recovery

Use this procedure for a lost Task, a previous version, an interrupted restore or uncertain backup coverage. The live register and private history answer different questions: refresh answers what exists now; a snapshot preserves what was observed before a change. [ADR-0045](adr/0045-task-recovery-history-is-independent-of-the-live-register.md) owns the boundary.

## Inspect coverage

Read the configured target's history with `tasks recovery --config <private-config> --target <configured-key> --json`. Read an exact historical version with `--snapshot <snapshot-id>` and keep that content private. The report also exposes current lifecycle revision and the last refresh receipt; obtain a fresh provider token through the ordinary register refresh before planning a restore.

Check the selected version's capture time, target/list, exact original Task ID, provider status, local provenance, source occurrence and native-timing coverage. A snapshot's `live` rows are historical provider observations; its `register` is the local state observed before publication and can be stale. An ID absent from historical provider rows has no proved provider recovery state. A deleted provider row or a register-only title cannot prove what should be recreated. Expired snapshots report unavailable; do not substitute a title match.

Coverage begins with successful installed captures. Changes made between refreshes may never have been observed. Native start/end/duration/timezone remain unknown unless that snapshot contains independently validated timing evidence. A Calendar projection ID does not identify a native Task. A cross-surface clock disagreement remains unresolved even after one UI surface persists its edit after reload. Preserve the surfaces, exact identities and observation times; verify the native editor before any timing reconstruction. When the host system zone differs from Calendar, use the Calendar-side Task editor and read back in the intended IANA timezone. Record both observed zones; shifting the actual Task to compensate would corrupt its schedule.

## Review one restore

Create a private `task-restore/1` JSON plan naming one snapshot, original Task ID and stable source occurrence. Use the strict schema exposed by `src/tasks/task-restore-types.ts`. Bind the current full-list `expectedSnapshot`, `expectedLifecycleRevision`, exact target/list, stable operation ID, policy version and the Owner's exact approval reference. The scheduling field explicitly acknowledges an API-fields-only recreation and unavailable timing. If the historical provider has a date, native timing, description or hierarchy, the current adapter refuses rather than silently dropping it.

Run `tasks restore --config <private-config> --plan <private-plan> --json` to preview. Completion means a fresh provider/lifecycle preflight returned `preview`; inspection of a JSON file alone is insufficient. Review the proposed original-to-new identity boundary and limitations with the Owner before applying the exact plan with `--apply`. This procedure supplies no standing authority to recreate real academic work.

Owner-dismissed occurrences stay dismissed. Completed historical work is recreated completed; open history cannot reopen a terminal completion. A still-existing original, live verified alias or possible duplicate returns a conflict. Resolve changed/manual state with a new reviewed plan; the executor does not choose another Task or overwrite one.

## Reconcile interruption

Retry the same operation ID and identical plan. A known new ID is read back and reconciled into lifecycle evidence and the register without another create. An unknown creation outcome remains `uncertain`; preserve its source claim, receipt and retained snapshot. Reobserve exact identities and resolve the original operation before another plan. A new operation ID is not a retry strategy.

After an applied result, read the normal register and receipt, verify the new provider ID/status/provenance and old cancelled history, and confirm client propagation when required. Google assigns a new ID; original IDs, edit history, completion timestamps, hierarchy and timing are not restored by this API route. Never describe it as recovery of the original Google object.

## Storage and rollout

History lives under the configured private state root in `task-recovery`; restore-prefixed receipts and permanent duplicate claims live beside ordinary operation journals in `task-operations`. Default history retention is 90 days, 512 snapshots and 64 MiB globally. Unresolved sends hold durable references. Partial captures and interrupted pins require exact owned evidence review; they are never restorable versions or a reason to delete unrelated state. A failed capture leaves the target stale or the write unsent. Capacity pressure or unsafe files fail closed. Original `task-register-backups` and existing journals are separate evidence and are not silently purged by this policy.

Install only from a clean reviewed revision after the existing morning routine and repository maintenance reach terminal idle. Retain the current source hash, built artifacts, original plist bytes and process/job status. Temporarily coordinate the existing services using the documented maintenance window, build once, reload the same Operations service and restore the unchanged refresh plist. Confirm the protocol catalog, source/build hashes, job cadence and all target capture/refresh receipts. A read-only provider refresh can establish initial coverage; synthetic restore acceptance supplies no authority for live deletion or recreation tests.

Rollback reinstalls the retained source/build and identical services without removing new recovery history, restore claims or lifecycle mappings. Do not rewind real provider state or private journals. Existing task-plan/1 clients need no schema migration. Future restore clients must negotiate this separate schema and explicit native timing limitations.
