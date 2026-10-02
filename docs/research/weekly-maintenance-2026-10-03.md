# Daily repair and weekly review evidence

Issue [#274](https://github.com/Jerome-Group/academic-os/issues/274) changes attention frequency,
preserving daily maintenance and including merged fixes in the weekly review. Repository coverage
from the earlier [audit](academic-os-audit-2026-10-02.md) remains the baseline.

## Evidenced failures and corrections

Inherited temporary variables broadened the installed Codex sandbox's writable area despite
exclusion flags. The actual production-helper synthetic probe initially overwrote an external
sentinel. Rooting `TMPDIR`, `TMP` and `TEMP` inside the isolated checkout corrected the boundary:
independent actual-helper probes then allowed checkout writes and denied external writes, symlink
escapes and localhost binds. Original and corrected receipts remain private. External reads remain
possible; this is a write/network boundary, not confidentiality isolation.

Inherited MCP/app channels are separate from that boundary. An empty `mcp_servers` table did not
disable configured servers. Per-invocation feature restrictions and individual disabled-server
overrides were verified through metadata enumeration without starting servers or model workers.
The [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
explicitly places connector traffic outside the sandboxed-command proxy. Browser/computer tools
and hooks need their own restrictions. Actual future serving-tool exposure remains unobserved.

Fresh-agent status discovery exposed a false success: a minimal state object could claim healthy
or rolled out without its receipt. Status now validates retained receipt identity, permissions,
observation time and separate combined-main/rollout facts. It reports historical evidence, not
current provider health. CLI fixtures cover missing, malformed and incomplete receipts.

Weekly review fixtures cover global issue identity, exact-scope updates, quiet first publication,
closed quiet issues, Monday rollover, Owner notes, changed readback, interrupted transfers and
legacy private snapshots. Verified merge facts survive quiet repeats and absent new attestations.
Transfers preserve original predecessor bodies unchanged and publish only a fixed safe closure
comment after successor readback; historical private-looking body text is never resubmitted.
Daily maintenance totals survive subsequent quiet days and conservatively deduplicate reruns.
Merged PR discovery uses exact Singapore-week timestamps and only public-safe numeric/hash fields.

The repair controller retains uncertain mutation checkpoints and resumes pending checks without
repeating implementation, review or publication. Stable failed-evidence fingerprints suppress
unchanged workers. Diagnostics rerun only failed checks and retain private concrete evidence;
missing/truncated evidence refuses model dispatch. Sensitive safety/quality/controller paths stay
outside automatic repair scope.

## Verification and measurement limits

The first combined full quality run passed all profiles in approximately 54 seconds: format,
lint, build, installed skill runtime, complete tests/privacy through rule coverage, seeded template
compilation and the synthetic cheatsheet journey. Subsequent exact-head checks and deployed
entrypoint verification are required before rollout completion; this intermediate timing is not
a completion claim.

A fresh Sol/medium agent discovered the index, status/check-only operations and fixed weekly
format from repository pointers, executed synthetic status fixtures and inspected a rendered
weekly fixture. Its receipt-validation and wording findings were fixed. Worker-count fixtures
establish zero model dispatch for healthy and unchanged cases, and no redispatch when pending
checks resume. They do not establish dollar savings or a model-quality comparison.

The existing Module worker still requests Luna/max. New repository repair/review roles request
Sol/medium per invocation. Serving identity, hard token caps and future scheduled execution are
unverified. No actual failing repository worker was launched for this rollout. No live Module
maintenance replay, coursework authoring, Google writes, new credentials or global setting changes
were performed. Current checks do not prove mathematical correctness or every possible defect.
