# What this folder is

The MODULE_CODE module folder: one module's material, laid out to a pinned
contract. This file is the router — every piece of work starts at a route
below and runs by its procedure.

## Start here

Read `CONTEXT.md` (how material is named and classified here) and
`00 Module Admin/00 Module Profile.md` (what this module is). Before
creating, naming, moving or placing any file, read
`docs/00 Structure and Naming.md` — the ground rules every route presumes.

## Routes

Read the route's procedure before acting in its area.

- **Curation** — new NTULearn material into its canonical home:
  `docs/10 Curation Procedure.md`, recording in
  `00 Module Admin/20 Curation Register.jsonl`.
- **Teaching** — lectures, revision and past papers in `70 Learning/`:
  `docs/20 Teaching Procedure.md`, with activity targets in
  `00 Module Admin/40 Source Map.yaml` and optional module conduct in
  `70 Learning/preferences.local.md`.
- **Cheatsheets** — source-led releases in `10 Learning Materials/30 Personal Notes/`:
  `docs/40 Cheatsheet Procedure.md`.
- **Tutorials** — curated sheets in `20 Tutorials/`; attempts, grading and
  writeups in `70 Learning/20 Tutorials/`: `docs/20 Teaching Procedure.md`.
- **Textbooks** — chapters into `10 Learning Materials/20 Textbook Chapters/`:
  `docs/30 Textbook Procedure.md`, recording in
  `00 Module Admin/50 Textbook Register.yaml`.
- **Tasks** — Owner-accepted next actions and explicitly reported completion follow the
  Tasks protocol below. The live list mirrors into `00 Module Admin/30 Task Register.yaml`;
  this generated register is refreshed through the tools rather than edited by hand.
- **Assessments** — graded-work artifacts in `30 Assessments/`, placed per
  the structure doc.
- **Projects/Labs** — `40 Projects and Labs/`, placed per the structure doc.
- **Maintenance** — structure questions, definition and profile updates:
  `docs/00 Structure and Naming.md` and
  `00 Module Admin/10 Module Definition.yaml`.

**Tasks protocol**

1. Refresh the tool catalog and call `tasks_sync_capabilities`; require `task-plan/1`.
   Call `tasks_read_register` with the exact configured `semester` and `module`. A successful
   fresh read supplies `execution.target`, `execution.listId` and `execution.expectedSnapshot`. A
   stale read supplies no new execution token. Select existing work by its returned `taskId`.
2. Retain cloud planning's exact intent and current `policyVersion`. Persist an immutable plan
   with `schemaVersion: 1`, a stable `operationId`, the observed target/list/snapshot and the
   exact `operation`. Missing intent or policy parks the mutation; the executor never invents or
   replans them. Creation additionally requires exact source identity as a stable
   `sourceOccurrenceId`. For creation, retain supplied provenance inside `operation.provenance` as
   local metadata:
   `assessment`, `source` and `milestone`. Preserve what was supplied rather than inventing
   provenance or descriptions.
3. Call `tasks_apply_plan` with string `plan_json`, or `tasks_create`, `tasks_change` or
   `tasks_complete` with that same plan and matching legacy arguments. Parse the MCP text JSON;
   require `isError: false`, `outcome: applied`, the matching `operationId`, a nonempty returned
   `taskId` and `registerFresh: true`. For change/complete/cancel, also require that returned ID to
   equal `plan.operation.taskId`. These establish API/register success.
   Read fresh state before each new operation. Return conflicts to planning; retain the identical
   plan and operation ID for reconciliation after errors or uncertain effects. An unknown-ID
   create stays fenced. Another ID or a title match never authorizes a replacement create.
4. Supported API writes are undated creation, title changes and explicit completion; cancellation
   through the generic apply tool requires explicit Owner intent. New notes/descriptions are
   refused. Plans containing `doDate` or `timing` are refused while the native adapter is
   unavailable; existing tool names do not promise the former date/notes behavior.

For Owner-authorized date/time placement, delegate the unchanged native plan to an already
authorized UI executor. Require fresh complete native preflight covering manual placements,
Busy, meals and dismissals; retain exact account/list/task IDs or evidence-verified aliases,
surface, displayed timezone and acquisition time. Require same-ID Task saved-field readback
afterwards. Missing execution support or contradictory observations park the placement. Never
infer an offset or timing from the date-only API, or substitute an ordinary event. API `applied`
does not establish native acceptance or grant UI authority. Deadlines remain Calendar milestones.

## Domain language

`CONTEXT.md` is this module's organisational language;
`70 Learning/GLOSSARY.md` is the subject speaking. The test: a term that
changes where a file goes or what it is named belongs in `CONTEXT.md`;
a term of the subject matter belongs in the workspace glossary. Consult
both, and `docs/adr/`, before classifying, naming or organising content.

Mint a term only from an ambiguity that actually bit: the Owner resolved a
parked item on the meaning of a word, or a live session showed Owner and
agent meaning different things by one word. With the Owner present, show
the drafted entry in that exchange — their yes on the wording is the
approval. Unattended, load the domain-modeling discipline and apply its
tests before writing, and surface every write in the run's report.

A module ADR records a standing rule the contract does not force, whose
reversal would strand records built on it. Numbered locally from 0001;
superseded by a new ADR, never edited. Register entries cite it from their
evidence field.

## Safety

Work here runs through a route. Anything no route or procedure covers
parks for the Owner: a parked item is a good outcome, an invented one is
not.

- Importer roots (`NTULearn` and any declared sibling) are read-only —
  curation copies out of them, leaving names and layout untouched.
- Registers change only through their procedures.
- Issued sources and Owner attempts retain their original bytes; teaching writes beside them.
- Records append or supersede. Their existence proves neither completion nor understanding.
- Structure changes only through the structure doc — a directory it does
  not name is an Owner decision.

## Updating these instructions

This file and the five docs it names are pinned: their text is the
contract's, identical in every module, and the auditor flags a stale copy.
Before editing, name the exact file and section. Authorization for the requested
task persists through routine reversible changes; ask only when an unresolved
choice changes the result. Module-specific knowledge lives in `CONTEXT.md`,
`docs/adr/`, the profile, or `70 Learning/preferences.local.md` — never here.

Draft any change to a doc agents read — this file, the five docs,
`CONTEXT.md`, an ADR — with the writing-for-agents discipline before
showing or writing it.
