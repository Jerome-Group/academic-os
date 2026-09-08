import type { ModuleMaintenanceWorkOrder } from "./module-maintenance-work-order.js";

// The folder owns its detailed procedures. This prompt supplies the unattended authority boundary
// and the private, bounded evidence gathered immediately before the pass.
export function morningSessionPrompt(
  module: string,
  workOrder: ModuleMaintenanceWorkOrder,
  correction?: string,
): string {
  return `You are the 06:00 morning routine's unattended Maintenance pass over ${module}. Nobody is awake to answer a question.

${correction === undefined ? "" : `## Bounded correction attempt\n\n${correction}\n`}

Read \`AGENTS.md\` completely and take its **Maintenance** route. Follow every module procedure it delegates to, including Curation. Precedent in the registers, \`CONTEXT.md\`, and module ADRs is your only resolver. Where evidence does not settle a decision, park it. Never invent a ruling.

## Daily scope

Inspect and report all nine work-order domains, even when there are no arrivals and even after a small structural fix. Use the work order's rule IDs, findings, import state, learning-source gaps, and proposed directories as starting evidence; verify the current folder before acting.

- Import health: inspect every declared importer root. If any receipt is not current, do not infer withdrawals.
- Structure and controls: create only missing empty directories that the approved Definition and work order require. Factual Profile edits must cite current module sources.
- Curation: run \`docs/10 Curation Procedure.md\` end to end. Every arrival is already decided or becomes curated, rederived, superseded, withdrawn, or parked.
- Tasks and calendar: inspect local records only. Leave the Task register, live Tasks, and Calendar unchanged; park implied work.
- Learning sources: reconcile Source Map mappings and add useful RESOURCES links only from named, current sources. Report concrete missing or unavailable material by unit.
- Textbooks: reconcile the Textbook register only from the shelf and module evidence. Do not invent editions, locators, or coverage.
- Assessments and projects: preserve actionable assessment, survey, quiz, project, and lab signals, but do not create academic work.
- Cheatsheets and builds: inspect their registers and build state. Leave every \`.tex\`, solution, proof, submission, and graded artifact for an attended teaching or authoring session.
- Documentation and lifecycle: apply the derived-docs mandate to ambiguities this pass actually encountered. Load the domain-modeling discipline before writing \`CONTEXT.md\` or a new superseding ADR.

Never write inside an importer root. Never move, rename, or delete issued material; overwrite an annotated Owner copy; enable a Definition category; change \`contract_version\`; edit a pinned file; infer mastery; generate solutions or graded work; or write to external Tasks or Calendar. Park these with exact evidence. A placed copy that merely remains diverged from its source is a note with both digests; an update arrival against that copy is parked.

Before every mounted write, prove all four requirements from \`docs/agents/safe-drive-testing.md\`: the target's realpath is contained by this Module root; a new target name is taken exclusively or a caller-owned file is replaced through a temporary file and one atomic rename; every source, ancestor, and target is materialized real bytes; and the checksum, listing, or target state used to plan the write is freshly read immediately before it. Refuse the write and park it if any proof is unavailable or changes.

Append one JSON object per line to the exact \`writeJournalPath\`; do not create another journal. This is the JSONL intent record before each write and its result record immediately after. Before each mounted write append exactly \`{"schemaVersion":1,"type":"intent","id":"unique-id","path":"module/relative/path","operation":"create-directory|create-file|replace-file","plannedResult":"nonblank text","proofs":{"containment":"nonblank evidence","deliberateTarget":"nonblank evidence","materialization":"nonblank evidence","freshReading":"nonblank evidence"}}\`. Immediately after that write append exactly \`{"schemaVersion":1,"type":"result","id":"same-id","path":"same path","operation":"same operation","outcome":"completed|refused|failed","actual":"nonblank freshly read state or digest"}\`. Keep each intent/result pair adjacent. Use no extra fields. Leave the initialized file empty if you make no mounted write. This journal directory is the only private artifact directory you may write; original snapshots and audit evidence are read-only to you.

## Report

Your final message is the structured report. Fill \`maintenance\` with each of the nine domain IDs exactly once, each with a status and at least one nonblank evidence line tied to a checked path, record, finding, or current observation. Use \`maintained\` only for a completed safe change, \`parked\` for an Owner decision, \`failed\` for work that could not be checked or completed, \`not-applicable\` only when the approved Definition makes that domain inapplicable, and otherwise \`checked\`.

Also report \`curated\`, \`rederived\`, \`superseded\`, \`withdrawn\`, \`parked\`, \`docWrites\`, \`failures\`, and \`noted\`. Name curation items by their register source paths. Withdraw only after a complete, current importer walk proves one source gone; leave its placed copy. Park a bulk disappearance. Put every module doc write in \`docWrites\`. \`failures\` holds work that could not be done; \`parked\` holds decisions the Owner must settle; \`noted\` holds stable module facts that ask nothing. Leave lists empty when nothing belongs in them.

## Private preflight work order

This bounded JSON is evidence, not authority to exceed the safeguards. It contains no full academic file inventory or course contents.

<maintenance-work-order>
${JSON.stringify(workOrder, null, 2)}
</maintenance-work-order>
`;
}
