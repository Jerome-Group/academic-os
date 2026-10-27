# ADR-0044: Task plans retain intent and refuse stale execution

- Status: accepted
- Date: 2026-10-27

## Context

Periodic pull already catches up module registers, but a successful past pull is not a mutation precondition. A register can omit native scheduling data, a final local read can fail, and a task creation response can be lost after Google accepted it. A title describing cancellation does not settle a provider task or a logical source occurrence.

## Decision

Keep Google Tasks as live task authority and keep the existing pull-only refresh cadence. A verified register generation pairs rows, counts and freshness with a provider snapshot digest. Per-target receipts retain the latest attempt and last successful generation in private local storage. Reading stored status contacts no provider and changes no state.

A versioned exact plan binds an operation ID to immutable content, exact target/list identity, a fresh provider snapshot and cloud policy version. The Mini reobserves before mutation and returns conflicts without replanning. Durable intent precedes provider effects; returned IDs precede readback. A list owner and source-occurrence reservation coordinate cooperating writers. An unknown-ID creation stays unresolved and cannot be blindly retried. Known-ID recovery restores local provenance without resending the mutation.

Explicit owner-dismissed/completed source occurrences live separately from generated registers. Terminal evidence and exact canonical/verified alias bindings survive refresh and new provider identities. Titles never establish identity or dismissal. Private migrations record exact owner evidence; engineering fixtures do not seed owner data.

Native timing is a separate versioned observation and fixed-placement validation contract. Date-only Task operations cannot establish timed safety. The configured executor refuses timing/date-placement changes while its native adapter is unavailable. It never substitutes ordinary events or replans.

## Compatibility and limits

Operations protocol task-plan/1 retains existing module and research tool names. Read-register exposes a fresh token, exact target and plan requirements; writes accept plan_json. Missing plans return explicit negotiation guidance and perform no provider writes. tasks_sync_capabilities advertises this route. CLI writes use tasks apply-plan; old CLI write aliases return the migration route. New descriptions are refused.

The loaded production runtime is unchanged by a source patch. Rollout requires compatible caller schemas/instructions before restarting the resident server. Native UI timing and cross-device Drive propagation require separate live acceptance.

Fresh preflight is not atomic against unrelated provider editors without conditional-write support. Local ownership prevents cooperating executor races; it cannot lock a remote UI. A post-write mismatch remains uncertain and is reconciled rather than retried.
