# Daily repair rolls up into a weekly review

> [ADR-0039](0039-check-fixtures-have-an-isolated-private-root.md) supersedes temporary-root
> placement inside the code checkout. Its remaining boundaries and weekly review decision stand.

Status: accepted. Issue: #274.

Daily issues asked the Owner to repeatedly distinguish resolved work from unresolved incidents.
The Owner chose daily discovery and eligible automatic repository repair with one weekly review,
including merged fixes. The schedule and the narrow Module Maintenance authority remain intact.

One repository-wide issue represents each Monday-start offering week. Its introduction is created
once. Immutable as-of review comments carry exact scope observations and the fixed public sections.
Owner body text and comments stay in place. Publication exposes no body replacement, comment edit,
or deletion operation. Issue #349 demonstrated that a final read before body replacement still
loses a concurrent Owner edit.

A private repository-wide JSONL journal serializes publication across weeks through the existing
journal mutation owner. Maintenance runs capture exact scope and repository predecessor heads
before work. The publication callback combines contributions from a complete bounded scan of trusted
history. Incomparable contradictory observations remain awaiting fresh work that names both heads.
Same-day positive maintenance receipts use maxima. Exact merge identities union, and missing
verification never erases a positive receipt. An unchanged quiet observation within the same week
keeps its honest public as-of date. New positive receipts, changed status, conflict reconciliation,
and a new week publish.

The private journal binds numeric authenticated publisher and repository IDs. A marker, login, or
author association grants no authority. Exact original machine comments remain privately retained.
Changed or missing known comments require reconciliation. Privileged same-account edits cannot be
attributed independently. Durable intents precede remote writes. A timed-out POST remains unknown
even after a negative list, until an exact trusted match is read back. It is never reposted
automatically. A recognizable anchor survives failure before its first review comment.

Rollover scans closed trusted anchors as well as open ones and privately snapshots complete observed
body and comment text before transfer and close. The successor links Owner notes at their source.
A verified fixed transfer comment and state-only close retire a predecessor without claiming
resolution. Legacy markers without exact private publication receipts remain evidence-unknown.
The bounded scan admits at most 500 observations and 10,000 raw issue records or comments, with at
most 100 provider pages per listing. Raw issue records include pull requests. Discussion text and
the private journal each have a 32 MiB bound. Admission covers the complete observed history plus
the known planned anchor, review, transfer and state work before its first remote mutation.
Journal headroom includes JSON-escaped intent, readback and receipt bytes. Each new record reserves
a possible additional provider page, because a page need not contain 100 records.

Later concurrent growth, provider page layout or unused response metadata can still exceed a bounded
read budget after a preserved effect. That stops further publication and retains unresolved intents;
it does not authorize a repost. This is admission under observed history, not a provider transaction.
The bounded history window keeps evidence simpler than recursive carry records. It neither seals
closed discussions nor
provides provider snapshot isolation. The serialized writer boundary is one host with one canonical
configured private state root, including retained runs.

The repository owns a bounded repair controller and discoverable CLI entrypoints now. Deterministic
checks precede model dispatch. Only new eligible failures dispatch an implementer and independent
reviewers; stable fingerprints and checkpoints suppress repeated workers. Protected exact-head
checks, resolved findings, fresh base and verified squash merge gate publication. Combined-main
verification and clean primary rollout have separate outcomes. Unknown interrupted mutations retain
their evidence and require reconciliation rather than blind repetition.

The installed macOS sandbox enforces writes and disables network during worker/check execution.
Temp variables must point inside the checkout; exclusion flags alone did not constrain inherited
temporary grants. Actual production-helper probes establish this boundary. External reads remain
possible, so it is not a confidentiality boundary. Apps/connectors also bypass shell network
restrictions; disable external tool channels and inherited MCP servers per invocation and verify
that configuration before dispatch. Public material, synthetic regressions and private diagnostics
remain essential invariants. Future backend/tool exposure is not attested by configuration metadata.

This supersedes daily public issue creation and retirement in ADR-0032 and ADR-0036, and separate
scoped issue identities in ADR-0037. Their complete-domain evidence, public allowlist, retention and
target authority boundaries remain. [`weekly-maintenance.md`](../agents/weekly-maintenance.md) owns
current review conduct; command metadata and executable tests own discoverability and verification.
