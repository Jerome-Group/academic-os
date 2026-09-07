# Academic workspace renewal

Plan for #221 and #222, 2026-09-08. The Owner selected the current active Module workspaces and
Research project as the baseline. The contract should explain and support their useful evolution.
A mismatch with the old contract is evidence to investigate, not authority to revert academic work.

## Audit and evidence

The audit inspected all six configured active Modules, the active Research project, their control
documents, procedures, records and template differences, both installed local router skills, the
cheatsheet source graph and rendered release, scheduled jobs, and every repository subsystem below.
Academic sources, inventories, hashes and recovery plans remain private. Academic correctness is
reviewed where an artifact changes; this systems audit does not certify every existing proof.

Baseline `dc69f1e`: `npm run check` passes; 678 tests pass with one expected platform skip; all eight
LaTeX seed documents compile. Four calendar regression suites pass all 87 tests. The obsolete
calendar PR was superseded by already merged fixes. Historical morning reports were reviewed and
their remaining decisions consolidated into #221 without marking academic tasks complete.

| Subsystem | Finding and decision |
| --- | --- |
| Contract, conformance and controls | Profile and Source Map validators reject useful current detail; Research validation describes an abandoned parallel workspace. Update semantic interfaces and keep deterministic findings distinct from judgment. |
| Seeding and mounted writes | Keep configured-root discovery, materialization checks, staged exclusive creation and resumable journals. Add recoverable selective updates rather than reseeding occupied workspaces. |
| Cohort and observations | Active selection and separate Research observations work. Preserve before/after evidence; a contract-version change remains migration evidence. |
| Drive inventory and repair | Retain read-only paginated inventory and ID-bound recovery. This campaign primarily changes backed-up controls and artifact organization, not importer trees. |
| Curation and textbooks | Repeated source departures and unclassified metadata need recorded decisions. Preserve append-only history, placed copies and the existing shelf system. |
| Tasks | Pulls preserve provider identity but rewrite entire YAML even when unchanged; the file store has no fresh-byte precondition or original-byte backup. Strengthen this before increasing cadence. |
| Calendar | Current recurrence and milestone fixes work. Preserve preview, conflict checking, verified promotion and live authority; improve mirror freshness. |
| Morning routine | Structured results and per-module isolation work. Update model/instructions and ensure a one-time actionable source signal remains visible until settled. |
| Launchd | Calendar refresh is daily; task refresh is part of the morning pass. Add bounded periodic state refresh with private status and quiet healthy runs. |
| Operations server | Keep target-specific verified task operations. Exercise the improved register store through the existing command/tool paths. |
| Skills and instructions | Routes repeatedly encode approval pauses and assume one activity target per lecture unit. Clarify authorization and select actual activity targets. |
| CLI and reports | Keep human/JSON parity, explicit unsafe/stale outcomes and private metadata reports. |
| Publication and CI | Baseline checks pass; no dependency PR is pending. Use synthetic fixtures and public design findings, not copied academic material. |
| Repository guidance | Retain organisation-owned workflow, attribution and standards; add precise pointers for the new local interfaces. |

### Current Module practice

Five Profiles add useful requisites, readings, project milestones or textbook alignment. Assessment
tables add policy, coverage and permitted-aid details. These are valid human-facing facts. One
Source Authority table needs actual provenance rather than treating its final substantive column
as evidence. Typography differences in academic-year separators are not identity contradictions.

One Source Map already represents tutorial blocks with exercise locators and explicit missing
solutions. Preserve that structure. The six instruction sets otherwise share a common baseline;
their Teaching Procedure predates the latest cheatsheet addition. Their existing preferences and
ordinary LaTeX templates agree, so the audit supplies no basis for inventing six different standing
learning preferences.

Session records expose two duplicate sequence prefixes and a selection error: several tutorials or
papers can share one lecture unit. A record's existence indicates session coverage, not necessarily
completion or demonstrated understanding. Preserve those distinctions in continuation decisions.

### Current Research practice

Ordinary work belongs to a supervisor meeting, with its sources, learning, exercises and session
records together. Selected, Owner-adopted work may later enter Research. A session or meeting can
finish with no promotion. The existing live procedures and local decisions already describe this
coherently; the public seed and validator lag them.

The Source Register needs meeting originals, exact copies and scoped extracts. The Research Map
needs stable question/thread identity, meeting work and optional promoted outputs. Local prose,
mathematical vocabulary, supervisor guidance and completed records are not pinned template copies.

### Current cheatsheet practice

The latest promoted source is self-contained. An isolated build produced the same extracted text
and rendered pages as its live PDF. An older external review failed because its wrapper's included
files were missing. Both observations matter: retain portable compilation and test the review
packet rather than assuming that attaching a top-level file supplies its dependencies.

The successful visual baseline is dense monochrome portrait A4 with native mathematics, strong
section bands, compact question/source labels and distinct problem/solution emphasis. Navigation
is weakened by source-stream ordering, cryptic identifiers and anonymous continuations. Current
layout choices differ from the fixed seed geometry. A shared semantic interface with explicit
artifact constraints is more useful than requiring every module to render identically.

The support tree mixes durable source/review evidence with reproducible output. A directory named
`build` is not deletion authority. Every unique object must be classified before cleanup.

## Agent instruction design

The primary model source is OpenAI's [Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model),
fetched on the audit date. It recommends auditing instruction conflicts, honoring scoped
authorization, preparing concrete results before clarification, explicit delegation guidance,
concise writing and proportionate verification. Apply these principles with the Writing for Agents
skill: one source of each rule, ordered steps with observable completion, and conditional pointers
to branch-specific reference.

Astra low is the Owner's preference for routine module work; medium for multi-source synthesis,
substantial mathematical checking and curation. This is a local workload choice, not an OpenAI
benchmark claim. Respect the model actually selected by the harness; an instruction does not
silently change a running model. This campaign uses mostly Sol medium implementation/review agents,
with occasional Astra low independent review and root-led complex planning.

Each route states its editable files and regions before writing. User authorization persists across
the requested task. Routine reversible steps proceed; a question is reserved for an unresolved
choice that materially changes the result. Distinguish these boundaries:

| Material | Edit mode |
| --- | --- |
| Importer originals, supervisor originals, Owner attempts | Read or copy; retain original bytes. |
| Session records, curation history, adopted contribution history, ADRs | Append or supersede; retain prior entries and stable references. |
| Profile facts, source mappings, glossary entries, current ledgers | Update the identified section, row or stable key; preserve other content. |
| Live Task/Calendar state | Use the authoritative tool/CLI, verify the push, then refresh; preserve IDs and unrelated fields. |
| Generated mathematics | Edit the requested artifact region, retain provenance/status, compile and review the resulting artifact. |
| Shared instructions | Refresh from reviewed repository sources after comparing local changes. |
| Local mathematical choices | Keep in local preferences, vocabulary and decisions; inspect schema/links rather than byte-pin them. |

## Decisions and implementation scope

### 1. Module contract and teaching

Advance the Module contract to version 6. Keep the seven required Profile anchor headings in order,
each exactly once; permit additional uniquely named fact sections and nested subtopics in place.
This preserves the current presentation instead of moving facts to satisfy a stale heading check.
Read the first direct contiguous table in each required section. Resolve evidence by header name.
Accept assessment detail columns while requiring Component, Weight, a timing column and Evidence;
accept the documented Source Authority provenance variants. Compare year values semantically.

Formalize the existing legacy-path/structured-tutorial union with typed source locators and missing
evidence. Preserve historical manual-source locators in curation records through an explicit
manual-origin rule; importer identities remain relative. Keep unknown machine fields detectable.

Rewrite shared instructions around activity-target selection and exact edit regions. Add an optional
module-owned preference overlay without fabricating preferences. New session records identify the
activity target and honest status. Resolve legacy records from their actual target evidence.
`/learn` remains user-invoked and routing-only; it selects a requested target first and consults the
live procedure for continuation instead of treating the first record as mastery.

### 2. Meeting-centred Research contract

Advance Research to version 2. Required shared templates move to `60 Templates`; ordinary learning
and exercises remain inside `20 Supervisor Meetings/<date and topic>/`. Research holds optional
`10 Concepts`, `20 Research Notes` and promotion records. Keep the existing programme-derived
Deliverable homes. Seed missing containers without manufacturing academic work.

Define a patterned meeting interface: valid date, lifecycle status, `Meeting.md`, Sources, Learning
and Exercises areas with records. Calendar owns confirmed dates; the local schedule is an index;
meeting prose owns attribution and settlement. Historical meetings and records remain durable.

Extend Source Register rows with storage (`project` or `meeting`) and typed related files (exact
copy or extract, with their use). Extend Research Map rows with question/order, meeting pointers,
units/sets/records and promoted outputs. Coarse lifecycle remains typed; finer progress is local
text. Verify every referenced path and source/question identity. Preserve the meaning of current
metadata during the narrow conversion.

Pin shared router/procedures and blank Markdown templates, retain locally editable LaTeX templates
and preferences overlays, and validate local vocabulary without requiring an obsolete heading.
`/research-project` follows actual routes in the selected live router, including Learning and
Exercises. It does not carry a competing route enumeration or mathematical policy.

Older Definitions explicitly report a migration requirement; they never silently pass as the new
version. Preview the new projected state before changing the live Definition, and change it last.
Historical observations remain distinguishable by their recorded contract version.

### 3. Cheatsheet framework and artifact hygiene

Keep the existing Personal Notes release address: `<artifact>.tex` and `<artifact>.pdf` at its top
level. Put durable authoring/provenance under `support/<artifact-id>/`, and reproducible fitting
output under `.scratch/cheatsheets/<artifact-id>/<run-id>/`. Retire drafts into the identified
support history after proving their bytes. A release TeX must compile when copied alone to a fresh
directory. TeX-distribution packages are declared prerequisites, not local hidden dependencies.

Introduce a user-invoked `/cheatsheet` route for create, revise, audit, verify and package-review.
The Module procedure owns conduct; the skill supplies discovery and the selected operation. Helpers
provide measurable build, dependency/portability and release checks. Maintain one authoring
authority: a manifest declares whether the self-contained release is directly authored or assembled
from named durable fragments. An edited release never gets silently regenerated from stale fragments.

An artifact manifest holds user constraints, source locators/digests, source authority, required
coverage, optional content priority, composition mode and release evidence. Coverage records every
required item or question part and every exclusion. Current assessment scope and issued sources
lead; audited module work, registered textbooks and historical material follow. Original examples
fill only an identified need. Quoted wording and a mathematical qualification remain distinguishable.

The fitting loop starts at the preferred font size. When sparse, restore required detail, expand
rigorous explanations and source-backed examples in priority order, then use spacing and typography
to fill the available page deliberately. When overflowing, remove duplicate framing, cross-reference
repeats, shorten solutions without losing conditions or reasoning, and cut optional material from
lowest priority upward. Measure every revision. The page constraint, required content and explicit
font floor are simultaneous gates; incompatible requirements are reported concretely rather than
hidden through scaling or omitted mathematics. Do not invent content merely to satisfy a density score.

Retain the current visual language while adding a compact page/section map, stable concept/topic
identifiers, readable source badges, page numbers and identified continuations. Choose changes from
actual rendered defects; preserve requested furniture and record actual reviewer/model provenance.
The review record distinguishes a requested credit, historical review and a passed current release.

Verify source coverage, mathematical assumptions, page size/count, native typography, glyphs,
overflow, clearances and every page/column visually. Review packets include complete editable sources
and digests; compile them in isolation. Record the exact reviewed PDF hash and recheck after changes.
The current sheet is the live acceptance artifact. Generic public fixtures exercise sparse/overflow
decisions, missing dependencies, changed reviewed hashes and the semantic typography interface.

### 4. Task and Calendar automation

First make Task-register writes selective and recoverable. Preserve comments, unknown local fields
and provenance; skip unchanged writes; reject an intervening edit, duplicate identity or unreadable
document. Hold original bytes in private recovery storage before publication and verify the result.
The deferred adapter must keep the same read/write state. Test this through filesystem and CLI seams.

Add a native state-refresh job every 30 minutes. It runs existing read-only Calendar and Tasks pulls,
isolates their failures, bounds execution and stores private freshness/failure status. Healthy or
unchanged runs stay quiet; notify on a meaningful failure/recovery transition. Replace the redundant
daily Calendar job only after the new job is verified. Keep the morning curation pass separately
scheduled and set its explicit workload model to Astra medium.

At session or meeting closeout, reconcile explicit completed work and accepted next actions with
the live task list, then refresh the register. Resolve authoritative assessment dates through the
existing preview/promotion path. Carry unresolved one-time source signals into durable follow-up
evidence. This campaign will settle the backlog's concrete survey/quiz gaps after a live duplicate
check; it will not infer academic completion or silently reschedule overdue work.

Automatic wholesale timetable planning, unattended meeting confirmation, Research promotion and
inferred mastery are deferred. They need actual user decisions and observed stable inputs, not
another language-model scheduler. Existing task and calendar authority boundaries remain intact.

### 5. Live migration and acceptance

Use the exact configured six active Modules and one active Research project. Keep historical
semesters and unrelated automations outside the transition. Private plans enumerate every target,
edit region, original hash, intended hash and relocation. Public commits contain only generic
implementation and aggregate evidence.

Before each live change, verify materialization and realpath containment, create an independent
byte backup outside Drive, compare its hash, and journal intent. Re-read the complete target set
before applying; refuse stale plans. Publish through exclusive creation or atomic replacement with
fresh preconditions. A partially applied run remains explicitly partial with its recovery journal.

Preserve all academic originals. Refresh shared controls only after reviewing their differences;
keep local mathematical text and templates. Apply structured metadata changes by stable keys.
Repair duplicate record numbering with byte-preserving, reference-checked renames. Relocate session
history from Profile only where its actual authority is a session record, preserving the whole block.
Preserve all existing task IDs/statuses and record source-departure decisions by appending.

Classify cheatsheet support objects by content before moving them. Keep unique sources, releases,
reviews and verification evidence durable. Retain generated residue if its status is unresolved.
Root transient directories may be inventoried as advisory residue; they are never seeded as academic
structure. Cleanup names exact verified objects and occurs only after the new release is sound.

Preview against the new contract with the future Definition value, then write that version last.
Run the fresh mounted audit and inspect every non-pass finding. Prove unchanged academic bytes,
resolved links, preserved record prefixes where not explicitly renamed, valid metadata and a
portable compiled cheatsheet. Keep backups until all these checks succeed; they may then be removed
by exact journal identity. A retained backup is preferable to an uncertain cleanup.

## Delivery order and completion

1. Review and merge this complete plan before implementation.
2. Land the Module interface/instruction slice with regression tests and router checks.
3. Land the Research interface/seeds/router slice with synthetic meeting and migration tests.
4. Land the cheatsheet workflow/helpers/design slice with source, fit and portability checks.
5. Land safe Task writes and scheduled state refresh with unchanged/concurrent/failure tests.
6. Apply the backed-up private transition, verify live artifacts, install local skills, then verify
   the actual scheduler and operations paths. Remote installs are claimed only when reachable.
7. Complete separate Standards and Spec reviews, relevant local checks, CI and serial squash merges;
   reconcile every issue criterion, close delivered issues, and leave `main` synchronized.

Implementation issues carry concrete acceptance criteria and link this plan. Any finding that changes
the scope updates the plan before dependent work starts. No release gate is satisfied merely by a
successful tool call: the resulting bytes, provider state or rendered artifact supply the evidence.
