# Daily maintenance requires complete domain evidence

The morning routine maintains each active Module even when no importer arrivals exist. Its
existing Curation route remains part of that pass, while a deterministic work order also surfaces
contract findings, importer health and learning-material gaps. The schedule, per-module model
and live-service authority remain unchanged.

Arrival-only curation left other Module obligations dependent on the Owner noticing them. Merely
asking an LLM to maintain everything would still permit an empty result to look successful.
Instead, each pass covers nine named domains, each with nonempty evidence and an explicit
`checked`, `maintained`, `parked`, `failed` or `not-applicable` status. The registry in
`src/routine/maintenance-domains.ts` maps every current normative Module rule exactly once;
contract coverage tests detect future omissions.

Before a session starts, its private artifacts hold a contract audit, a work order and copies of
readable controls. A fresh post-audit reports residual deterministic failures and newly actionable
findings independently of the LLM's claims. Malformed coverage becomes a visible failure while
readable action buckets survive. Quiet requires all domains evidenced as checked, successfully
maintained or inapplicable, with no parks or failures. Successful maintenance and doc writes remain
visible in the local report, without creating an issue. This supersedes the previous morning
policy that raised an issue solely for an unattended doc write.

The automation resolves ordinary findings before escalation. A fully verified clean pass can
close only explicitly marked morning issues for the exact same Module cohort; an unresolved
same-day rerun refreshes and, if needed, reopens its managed issue. Legacy and unrelated issues
retain their existing lifecycle. The marker proves ownership and scope, not that the work is done;
completion still requires the pass's evidence and independent checks.

The existing Maintenance route supplies authority: source-backed mutable control and reference
upkeep, precedented curation and harmless missing empty directories already approved by the
Definition. Mounted write safety still applies. Owner-led routes retain structural decisions,
pinned refresh, destructive correction, annotated material, academic authoring and external
Task/Calendar writes. A machine report does not make a semantic judgment correct.

`learning materials` exposes one of those inputs independently. It preserves Source Map unit
order and distinguishes regular-file availability from missing, unusable and unknown evidence,
including declared tutorial gaps. This improves preparation for a learning session without
inferring mastery, completion or an appropriate study order beyond the recorded one.

## Consequences

The morning report schema advances to version 2 with maintenance coverage. Older or incomplete
session results cannot earn silence. Existing unresolved conformance and missing importer receipts
may make the first upgraded morning noisy; inspect the evidence rather than suppress the checks.

The folder contract stays at version 6: no new universal path or pinned document is required.
Work orders and control copies remain in private session state and share its seven-day retention.
They support inspection and recovery; they are not permanent backups or proof of every edit's
correctness. All automated validation uses synthetic temporary Modules and injected sessions;
live operation remains a separate verification step.
