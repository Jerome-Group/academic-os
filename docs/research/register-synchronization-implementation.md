# Register synchronization implementation and acceptance

Scope: local code, synthetic fixtures and review only. Existing periodic refresh cadence, loaded Operations runtime, live tasks/calendars and configured register generations remain untouched during implementation. Publishing an issue/PR and deployment are separate owner-authorized steps.

Acceptance criteria:

- [x] Verified reads never present failed or mismatched rows as fresh empty data; per-target generation receipts preserve last success.
- [x] Operation IDs and source occurrences prevent duplicate effects through ambiguity, restart and concurrent execution; known provider IDs retain provenance.
- [x] Fresh exact-plan comparison returns owner-edit/lifecycle conflicts without silently replanning.
- [x] Explicit terminal lifecycle decisions survive refresh, replacement IDs and replay; aliases require verification evidence.
- [x] Native timing uses a separate versioned contract; unsupported timing refuses before provider mutation.
- [x] Existing module/research MCP callers can discover capabilities, obtain a read token and use their operation names through a documented guarded path.
- [x] Relevant isolated suites, type/lint/format/privacy checks and independent review pass.

Deployment requires the reviewed commit, a clean intended checkout, compatible client tool schemas, a deliberate build and resident-server restart. Reuse the current periodic job without cadence change. Record exact private owner dismissals through tasks record-lifecycle only after reviewing their source occurrence and canonical/alias identities; never infer them from a title or import an old planning snapshot. Then run official refresh/readback for the affected modules and separately verify current native placements, completion/dismissal preservation, protected windows, Busy/meals, rounding and absence of duplicate task projections.

No native adapter is activated by this work. Real provider authorization, native scheduling behavior, cross-device Drive convergence and production crash recovery are not proved by synthetic providers. Unknown-ID create outcomes remain blocked for exact reconciliation.
