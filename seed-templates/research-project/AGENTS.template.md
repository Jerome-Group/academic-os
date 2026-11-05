# What this folder is

The {{PROJECT_NAME}} Research project. Ordinary mathematical work starts and stays in one supervisor
meeting: sources, learning, exercises and session records remain together. Research is an optional
promotion of Owner-adopted meeting work, never the default workspace or a session requirement.

## Start here

Read `CONTEXT.md`, `00 Project Admin/00 Project Profile.md`,
`00 Project Admin/10 Project Definition.yaml` and `docs/00 Structure and Naming.md` before acting.

## Routes

- **Meeting cycle** — prepare, work or settle a meeting: `docs/20 Research Procedure.md`, the
  meeting's `Meeting.md` and `60 Templates/meeting-note.md`.
- **Sources** — place a complete canonical work or a meeting-specific artifact:
  `docs/10 Sources and Provenance.md` and `00 Project Admin/20 Source Register.yaml`.
- **Learning** — work a source passage, Owner question or mathematical discussion inside the
  active meeting's `10 Learning/`:
  `docs/20 Research Procedure.md`, `60 Templates/preferences.md` and
  `60 Templates/learning-walkthrough.tex`.
- **Exercises** — work an assigned problem set inside the active meeting's `20 Exercises/` using
  the Academic OS attempt, feedback, solutions and concepts workflow in
  `docs/20 Research Procedure.md`.
- **Research** — only when the Owner selects and adopts meeting work, optionally promote it into
  `70 Research/`: `docs/20 Research Procedure.md` and `00 Project Admin/40 Research Map.yaml`.
- **Deliverables** — plan, draft, check or record programme output:
  `docs/30 Deliverables Procedure.md` and `00 Project Admin/50 Deliverable Register.yaml`.
- **Tasks** — Owner-accepted next actions and explicitly reported completion follow the
  Tasks protocol below. The live list mirrors into `00 Project Admin/30 Task Register.yaml`;
  this generated register is refreshed through the tools rather than edited by hand.
- **Maintenance** — change structure, procedure or project language through `CONTEXT.md`, `docs/`
  and a new ADR.

**Tasks protocol**

1. Refresh the tool catalog and call `tasks_sync_capabilities`; require `task-plan/1`.
   Call `research_tasks_read_register` with the exact configured `research_project` key. A
   successful fresh read supplies `execution.target`, `execution.listId` and
   `execution.expectedSnapshot`. A stale read supplies no new execution token. Select existing
   work by its returned `taskId`.
2. Retain cloud planning's exact intent and current `policyVersion`. Persist an immutable plan
   with `schemaVersion: 1`, a stable `operationId`, the observed target/list/snapshot and the
   exact `operation`. Missing intent or policy parks the mutation; the executor never invents or
   replans them. Creation additionally requires exact source identity as a stable
   `sourceOccurrenceId`. For creation, retain supplied provenance inside `operation.provenance` as
   local metadata:
   `assessment`, `source` and `milestone`; Research also permits `claim`, `meeting` and
   `deliverable`. Preserve what was supplied rather than inventing provenance or descriptions.
3. Call `tasks_apply_plan` with string `plan_json`, or `research_tasks_create`,
   `research_tasks_change` or `research_tasks_complete` with that same plan and matching legacy
   arguments. Parse the MCP text JSON; require `isError: false`, `outcome: applied`, the matching `operationId`, a nonempty returned
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

## Stable identities

Meeting dates name cycles. Research-map keys join related work across meetings. Source IDs join a
canonical work, its scoped extracts and its exact meeting copies. Numbered learning units,
exercise sets and session records are display order, never stable identity.

## Safety

Before writing, name the route, exact target and editable files or regions. The request's authority
persists through routine reversible work on that target; ask only when an unresolved choice would
materially change the result.

Read or copy importer originals, supervisor originals and Owner attempts without changing their
bytes. Append or supersede records, decisions and contribution history. Update current ledgers by
stable key and preserve unrelated fields. Edit generated mathematics only in the requested artifact
region. Refresh shared controls from reviewed seed sources; keep local context, vocabulary,
preferences and mathematics project-owned.

The Owner authors mathematics and assessed work. Agents teach, ask, compile, check and critique.
Meeting artifacts may contain guided or candidate work with honest status. Nothing enters
`70 Research/` until the Owner reconstructs or rewrites it, checks its sources and chooses to
promote it. A complete session may record `none` for promotion. Record adopted material assistance
in `00 Project Admin/60 Contribution and AI Use.md`.

Primary sources outrank summaries. Complete books and programme authorities stay canonical;
meeting-specific emails, photographs, extracts and handouts stay with the meetings that use them.
Speculative literature is neither stored nor registered.

## Updating these instructions

`AGENTS.md`, `CLAUDE.md`, the four numbered docs and the blank Markdown templates named by the
Structure procedure are shared controls. A change begins in academic-os's canonical seed source;
preview and back up a target-scoped refresh rather than editing this project's copy directly.
Project context, records, preferences, mathematics and local ADRs remain project-owned. Show the
Owner exact standing wording before changing it. Record a structural rule in a new ADR and
supersede rather than edit an older ADR. Mechanical register writes follow their own routes.
