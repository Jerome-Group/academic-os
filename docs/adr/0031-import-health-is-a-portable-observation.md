# Import health is a portable observation

NTULearn publishes an optional `Sync status.json` per destination, and Academic OS reads those
receipts through `imports status`. The shared interface is
[`docs/import-status-contract.md`](../import-status-contract.md). It carries bounded counts and
lifecycle timestamps, keeping private State, source contents and source addresses out of the
integration.

`Last synced.md` intentionally updates after attempts with failed transfers. Parsing it would
make a recent failure look healthy and would take a dependency ADR-0012 expressly declined.
The new receipt answers the different question: what did the attempt observe? The stamp and
Profile citation rule remain unchanged.

The importer writes `running` before the course read so an interrupted attempt cannot leave a
newer-looking `complete` receipt behind. Only a completed walk with no failed transfers and no
unread categories records its own successful timestamp; other outcomes retain the validated
startup observation's value. Atomic replacement gives a reader a
whole observation. A clock error, invalid document or unsupported version is unavailable
evidence, never a successful fallback.

This is a diagnostic interface. Additive sync retains older sources, optional upstream views can
be incomplete, Drive can lag and manual syncs can overlap. A receipt therefore cannot prove the
current upstream set or grant curation authority. ADR-0020's full-walk and precedent requirements
still govern withdrawal. The command reads each declared root and retains sibling failures.
The morning routine consumes the same observation under
[ADR-0032](0032-daily-maintenance-requires-complete-domain-evidence.md); neither reader runs the importer.

## Consequences

One more small importer-owned file changes per attempt. Both projects carry the same synthetic
example and exercise the integration without credentials. Field additions require an explicit
receipt version rather than silently changing a consumer's meaning of `complete`.

The receipt is optional under the existing importer-root interior and existing source-only rule.
Folder contract version 6 remains unchanged. Old mirrors report missing evidence; they do not
need migration. The pinned Curation Procedure already classifies the importer's own writing as
source-only, so it remains byte-identical and this change requires no pinned refresh.

## Revisit when

A downstream feature needs transactional per-source evidence, independent media health or reliable
coordination between overlapping syncs. Those require a richer producer boundary, not interpreting
this observation as a guarantee it cannot provide.
