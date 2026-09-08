# Coordinated Module management

Academic OS owns Module structure, curation and the Task/Calendar authority boundaries.
NTULearn owns the additive importer and its observations. Improvements should make that handoff
explicit before adding more unattended decisions.

The 2026-09-08 paired changes deliver import health, learning-material visibility and comprehensive
daily Module maintenance. Later rows are proposals with their own acceptance boundary. The
roadmap schedules no work and authorizes no live data changes.

| Order | Feature | Academic OS outcome | NTULearn contribution |
| --- | --- | --- | --- |
| 1 | Import health | One read-only report of missing, stale and unsuccessful imports across declared roots | Atomic per-destination lifecycle receipts |
| 2 | Learning-material visibility | Source Map unit-order references, empty units and explicit tutorial gaps | Receipt freshness qualifies the available source evidence |
| 3 | Daily Module maintenance | Nine required domains, private work orders, control backups and pre/post audits | Per-root import status independently triggers attention |
| Next | Destination preflight and offering readiness | Explain which configured Modules lack valid imports, current controls or usable task bindings | Offline validation that configured destinations match exact declared importer roots |
| Later | Durable review inbox | Keep unresolved source questions visible until resolved, without repeating the same new issue every morning | Preserve evidence needed to identify repeated sightings |
| Later | Assessment signal intake | Preview a sourced Task or Calendar milestone from an unresolved assessment notice | Versioned factual signals from already permitted course reads |
| Later | Study-plan proposals | Propose a bounded week's work from explicit learning records, Tasks and confirmed dates | Import freshness as an input-quality warning |

## 1. Import health

`Last synced.md` records attempt time even after failed attachment transfers. The detailed result
was only transient command output; the watchdog's durable digest was aggregate. Meanwhile the
Module contract requires a completed importer walk before withdrawal. The paired
[Academic OS issue](https://github.com/Jerome-Group/academic-os/issues/235) and
[NTULearn issue](https://github.com/Jerome-Group/ntulearn/issues/134) add a small explicit interface
between these systems.

Acceptance: the producer exposes running, complete, partial and failed attempts; the consumer
validates them and shows freshness per declared root, with honest missing/invalid evidence.
See [the interface](../import-status-contract.md) and [ADR-0031](../adr/0031-import-health-is-a-portable-observation.md).
The receipt is not a source inventory or curation authorization.

## 2. Learning-material visibility

`learning materials` checks the active cohort's Source Maps without writing anything. It preserves
the recorded unit order and shows references by category, missing/non-file paths, empty units and
declared missing tutorial material. Unknown inventory coverage remains unknown. A regular file's
presence is availability evidence only: it says nothing about mastery or successful completion.

This report also supplies the daily work order. A learner can inspect a concrete preparation gap
before opening a teaching session, while source-backed Maintenance can reconcile stale mappings.
See [operation](../operator-guide.md#learning-materials).

## 3. Daily Module maintenance

Every daily pass now covers import health, structure/controls, curation, tasks/calendar, learning
sources, textbooks, assessments/projects, cheatsheets/builds and documentation/lifecycle. The
registry covers each normative Module rule exactly once. Before the LLM runs, deterministic
findings, importer observations and learning gaps form a private work order; control copies and
a post-audit make failures reviewable. Missing coverage cannot be reported as a quiet morning.
Successful routine fixes stay in the local report. Verified resolution closes only explicitly
managed morning issues for the same cohort; unresolved failures and Owner decisions still escalate.

This is broader than overnight arrival processing. Existing Maintenance routes can reconcile
source-backed mutable controls and references even on a day with no imports. Human decisions,
academic authoring, pinned refresh, destructive corrections and external Task/Calendar operations
keep their existing boundaries. [ADR-0032](../adr/0032-daily-maintenance-requires-complete-domain-evidence.md)
records the decision; [the operator guide](../operator-guide.md#morning-routine) describes artifacts
and reporting. The existing schedule, model and timeout remain in place.

## Next: destination preflight, then offering readiness

Current NTULearn configuration checks duplicate and nested destinations; Academic OS separately
declares exact importer roots in Module Definitions. A path can satisfy the first check and still
point into the wrong Module or a curated directory. This gap is visible at NTULearn's
`src/config.mjs` and Academic OS's `src/cohort/plan-cohort-audit.ts` and
`src/conformance/definition-shape.ts`.

Start with an offline comparison supplied both private configuration files. Report every missing,
extra and mismatched mapping with its remedy. Existing standalone NTULearn users remain supported;
contract checking is an explicit operation. Once that seam is proven, aggregate it with pinned
control conformance and Task-list binding for an offering-readiness report. Unknown evidence stays
unknown; the report does not seed, move, sync or provision anything.

Acceptance: fixture offerings with primary and tutorial sites, future semesters, duplicated
destinations, stale controls and absent bindings each produce precise independent findings.

## Later: durable review inbox

Morning questions currently live in dated reports and date-keyed GitHub issues
(`src/routine/run-morning-routine.ts`, `src/routine/types.ts`). The source may be settled as
`source-only` while its required action remains unresolved. The existing
[workspace review](academic-workspace-renewal.md#4-task-and-calendar-automation) already calls
for durable follow-up evidence; the morning prompt parks these signals but has no keyed
open/resolved record.

Add a private inbox keyed by Module, stable source identity and signal kind. Repeated sightings
attach fresh evidence to the same item. Explicit resolve/dismiss records explain why the item
left the open set. An inbox item is a question for review, not a second Task authority.

Acceptance: repeated mornings retain one open item; changed evidence is visible; resolution
survives refresh; conflicting evidence reopens review explicitly. Notifications follow meaningful
changes rather than the calendar day.

## Later: assessment signal intake

NTULearn already identifies interactions it cannot copy and writes a Markdown stand-in
(`src/sync/markdown.mjs`). A later factual feed could expose source identity, kind, title and
authoritative due/availability facts from the same permitted reads. Academic OS would bring
these into the review inbox and preview a Google Task or Calendar milestone when the Owner
resolves one. Exact addresses and academic facts remain private runtime data.

Acceptance: repeated signals do not duplicate Tasks or milestones; ambiguous dates stay open;
verified external IDs are recorded only after the existing operation succeeds. Unattended
curation parks actions; it does not promote them. Implement after the inbox has a stable identity
and resolution model.

## Later: study-plan proposals

The Module contract explicitly defers whole-week learning orchestration. The Source Map and
teaching records provide useful inputs but do not prove mastery. A planner could combine explicit
remaining work, accepted Tasks, confirmed milestones and Calendar availability into a proposal
with reasons and unresolved assumptions.

Acceptance: plans preserve the Source Map's explicit unit/order and recorded user constraints, distinguish fixed dates
from estimates, and preview every proposed change. Apply through existing Task operations and
Calendar Promotion; never infer completion or silently reschedule overdue work. Begin only when
the earlier evidence and review surfaces are stable.

## Evidence and rollout

The review used Academic OS `0daaf6c` and NTULearn `79956e9`, then current code in the paired
branches. Existing integration constraints are documented in
[the importer study](ntulearn-importer-destinations-and-state.md) and
[the Module contract](../module-folder-contract.md#importer-roots-and-curation).

Each slice needs paired interface fixtures where both repositories participate, independent
deployment behavior and a concrete migration boundary. Repository checks use synthetic files and
clients. Deployment, live sync and control refresh are separate operator actions; a checked PR
does not claim a live Module changed.
