---
name: control-publication
description: Check generated control publication and native host policy after changes to its account resolver, owner lifetime, claims, ledger replay, expected heads, complete graph, receipts, CLI, MCP or standalone package.
---

# Check control publication

A selected control generation must have complete immutable bytes and physically owned, durably ordered publication evidence.
A broken claim, missing parent barrier or early owner release can admit unrelated bytes or acknowledge incomplete publication.

## Run

Use Node 24 or later, installed dependencies, Darwin, the Node N-API headers and Apple clang.
Use Java 21 through `JAVA` or the runner's Homebrew Java 21 default.
Run from a clean committed checkout.

```sh
npm run control-publication:check
```

The runner uses the seed skill's pinned offline TLC bytes and checks its SHA-256 and Java major version.
It builds the product, then uses separately compiled native fixtures with fixed private anchors.
It never invokes the production account resolver or supplies an arbitrary publication root.
Every run retains a fresh evidence directory outside the repository.
Use `--evidence-parent /absolute/private/directory` after `--` to choose its parent.

Read the printed `results.json`, every model log, fixture `result.json`, `commands.json`, fault marker and mutation record at its original path.
Require all required boundaries to have outcome `passed`, eight mapped public mutation failures and eight restored passes.
Require the numeric/event checks, stable snapshots, expiry, bootstrap, CLI/MCP/extracted standalone journey and immutable byte readbacks.
Require all four orphan-append/barrier interruptions to retain the old physical attempt and select a different claimed attempt.
Require the fresh competing-call schedule to keep both supplied expectations unchanged, refuse B as busy while A holds ownership, then refuse the unchanged B as stale after A succeeds. This schedule uses no crash.
Require all recorded child PIDs to have exited.
`model-only`, `failed` and `bug` are incomplete outcomes and exit nonzero.
A `bug` result preserves a current-code counterexample. Never relabel it a passed gate.

Read every TLA+ result with pstack `/statechart`.
Explain the shortest failing path in the product's words and compare it to the retained compiled schedule.
Explain the successful state flow even when a separate property fails.
The statechart tool's interpreter is separate from the pinned checker identity.

## Scope

[Coverage](coverage.md) maps actions, source functions, runtime observations and reductions.
[The source binding](coverage.json) records the checked product commit and exact covered-source hashes.
The publisher model bounds are two writers, two candidates, two generations, one conflicting alias, one physical replacement, one crash/restart and one admitted effect.
One crash permits one retained unclaimed attempt and one fresh attempt. Orphan append, its file barrier and fresh reservation remain separate.
The native operations are synchronous. Expiry/drain tests establish ordering; no asynchronous native worker exists in this implementation.
Kernel exclusion, account discovery, native syscall behavior and filesystem durability remain runtime premises.
The model is neither implementation equivalence nor a universal power-loss theorem.
Existing seed evidence is checked for applicability only and supplies no publisher proof.
Pure Module transition validation precedes only new publication plans. Matching retries retain their original binding and settlement behavior.
The publisher model assumes admitted payloads. It has no Module history variables and proves no history-preservation theorem.
Run the separate `module-activity` workflow for source-bound public transition refusals and exact ledger readbacks.
For versioned Module controls, read `moduleVerificationMaintenance` in both source records.
Require 18 distinct roles and 20 supported role/schema pairs, with v2 alternatives only for verification and learning records.
Drive discovery, Module activity and produced/extracted current-v2 and pinned-v1 readbacks.
V2 structural acceptance must report verification as `not-implemented`; v1 keeps that field absent.
Schema declarations do not supply a verification compiler, grading engine or mathematical checker.

## Maintain

1. Run the ordinary command before editing verification. Retain the outcome.
2. Diff every covered source from `syncRevision`. Read intervening commit messages and identify moved functions or new writers.
   Refresh each mapped hash and literal symbol's line occurrences. The runner rejects stale navigation before TLC or native execution.
3. Classify each change as no effect, model drift, intended promise change or possible product bug. Keep claim append, syscall and parent barrier distinct.
   Preserve caller-supplied expectation before ownership separately from the resolved owned previous head. Never refresh caller input inside resolution.
4. Update the model from source. Replay every failing path against the public fixture. Keep genuine counterexamples and report them before product repair.
5. Run with `--candidate-revision <full-clean-HEAD>` to record candidate hashes. Require meaningful behavioral mutant failures and restored passes.
6. Advance `syncRevision` and exact hashes only after source mapping and observed behavior agree. Commit verification separately, then run the ordinary command again.

Use pstack `/maintain-formal-verification-skill` for changes that skipped these checks.
Keep each native binary and its fixture at its original absolute path.
Inspect SQLite sidecars through metadata only. Preserve links and FIFO entries without opening or following them.
Keep product repair, live data, provider access, Shelf probes and deployment outside this verification task.

For scanner-only maintenance, also follow [native inventory](../verify/features/native-inventory.md).
Read `sharedScannerMaintenance` in the source binding and code-model map before reusing the retained
native proof. The scanner remains a read-only observation premise. Its installed source closure is
checked before account entry. Source applicability plus targeted runtime checks do not constitute a
fresh complete publication run. Preserve the earlier full-run identity and report that boundary.

## Native host policy

Read `code-model-map.json` for the eleven source-bound properties and explicit reductions. Require21 TLC cases in every full run: six positive configurations and fifteen intentional counterexamples. Require the original eight and added eight actual-code mutant families, each with its predicted harmful observable and exact restored behavior. Read the native public-contract, repeated-history and unique-pressure results, planner accounting, physical output readbacks and actual produced/extracted-package evidence.

Native fixtures use the OS temporary directory. Set `TMPDIR`, `TMP` and `TEMP` to the same existing private directory on a supported local filesystem before building or running. Model outputs, logs and checker state may use a separate evidence parent. Never relax private-ancestry guards to accommodate an evidence volume. The runner retains fixture paths separately from model/log paths. Inspect SQLite sidecars through metadata only.

Require the source-derived49/70 native row vectors and all six added selector-move rows. Preserve the source-profile accounting premises and finite historical replay limit. Completed output retrieval is required only after supported history loads and physically verifies. Generated retries reserve the next complete path and retained obligations, without an invented attempt ceiling. Source identity, exact scope/metadata/bytes, dependency resolution, filesystem and process behavior remain runtime obligations. No acquisition, corpus preservation, total heap/RSS, infinite completion, power-loss or malicious-bootstrap theorem follows.
