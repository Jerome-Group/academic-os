# Seed ownership coverage

`coverage.json` records the last successful product revision. A candidate run leaves that record unchanged until every gate passes.
The maintenance inspection covers `fb381df4d0f5cbf8a4e9f2cca0e91bf8760378ea` through `64dfe99bcca15c13e9c49ab385da71656b857d1e`.
The only covered-source commit in that range is the ownership repair in #340.
The old source had unclaimed stage writes and recursive cleanup. The current source requires durable claims and exact entry removal.

## Bounds and assumptions

The positive configurations enumerate one target, one active stage pathname, two claim generations, two nested directory components, two approved files, and one foreign descendant slot.
Each entry has three identity tags, plus absence. Kinds are ordinary directory, file, link, or absent.
File bytes are approved, empty, partial, or foreign. Directory identities are abstracted per pathname and generation.
Each run permits two environment faults, one process interruption, and one explicit retry.
Absent and approved-partial targets run separately. Safety has no fairness or liveness premise.

One seeder owns the journal. Environment faults occur only before guarded operations, cleanup scans, or resumed invocations.
During a checked operation, the environment preserves the paths under inspection and mutation.
This is an environmental restriction, not atomicity supplied by Node.
The `syscall-swaps` configuration permits faults at every active program counter and must expose an escaped write.
The separate two-writer model must expose duplicate journal sequence numbers.

The model begins with an approved plan and a durable, valid journal start containing approved existing directory identities.
It models later durable event prefixes and an ambiguous append tail separately.
Private journal allocation, baseline capture, complete contract semantics, and mount materialization are prerequisites outside this initial model.
All modeled ordinary entries are materialized. Failed observations refuse.
The configured parent remains trusted and stable outside the modeled trees.
The stage pathname denotes the active generation. Earlier cleaned UUID paths are outside the live tree.
The foreign slot abstracts an unknown descendant without enumerating arbitrary names.

Process interruption between awaits retains filesystem effects and durable receipts.
Interruption during file writing can leave partial bytes. An append without its completed sync can leave an ambiguous tail and refuse retry.
No claim follows about power loss, inode reuse, advisory locking, native descriptor-relative operations, a live Drive mount, credentials, or academic recovery.
Completed publication means approved bytes were audited and current publication directory ownership was checked after cleanup.
It does not freeze file bytes against future external edits.

## Source mapping

The protocol adds `src/mounted/seed-ownership.ts` and version 2 journal events.
Each row was reconciled against the committed ownership repair, including its final byte readback, parser hardening and partial-root precision fix.

| Model actions | Source functions and awaited effects |
| --- | --- |
| Initial journal and approved partial tree | `captureSeedOwnership`, `startSeedJournal`. Valid durable start and materialized baseline are initial-state premises. |
| `Boundary`, `MkdirRoot` | `claimSeedStage`, `publishSeedPlan`. Reconcile intent, prove configured parent, then nonrecursive exclusive `mkdir`. |
| `CaptureRoot`, `RealpathNewRoot` | `directoryIdentity`, publication root observation. `lstat` and canonical `realpath` remain separate observations. |
| `LstatRoot`, `RealpathRoot`, `LstatParents`, `RealpathParents` | `proveSeedOperation`, `proveDirectory`, `directoryIdentity`. One ancestor is observed per loop iteration. Materialization is an explicit premise. |
| `InspectLeaf` | `inspectSeedOperation`. Existing staged entries require receipts. Existing matching publication files may remain additive no-ops. |
| `MkdirEntry`, `OpenFile`, `WriteFile`, `SyncFile`, `CloseFile` | `createOwnedSeedOperation`. Nonrecursive `mkdir` or exclusive `open`, byte write, file sync, and close. |
| `CaptureEntry`, `HashEntry` | `createOwnedSeedOperation`. Entry `lstat`, approved-byte read and checksum comparison before receipt. |
| `JournalOpen`, `JournalWrite`, `JournalSync`, `JournalClose` | `appendSeedJournalEvent`. Open, append bytes, sync, close. Root and entry receipts become durable before dependent effects. Compatibility operation events have no additional mutation authority and are abstracted away. |
| `Checkpoint`, `Advance`, `StageAudit` | `applyOperations`, domain `auditRoot`. Public checkpoints follow durable receipts. Stage contract audit is abstracted as permitting success, without supplying ownership authority. |
| `AuditLstat`, `AuditRead` | `auditTarget`, completed-target readback. Directory and approved-file observations occur separately. This does not model every contract rule. |
| `CleanupPreflight`, `CleanupLstat`, `CleanupHash`, `CleanupList` | `verifyStage`, `verifyEntry`. Inventory, entry observation, byte comparison, and directory listing are distinct steps. |
| `InspectRemoval`, `InspectRemovalEntry`, `HashRemovalEntry`, `RemoveEntry` | `removeOwnedSeedStage`. Reprove ancestors and entry, persist removal intent, then individual `unlink` or empty-directory `rmdir`. Repeated identical proofs within the protected operation are abstracted as redundant observations. |
| `Cleaned`, `Retry` | `stage-cleaned`, `stage-planned`, `claimSeedStage`. A cleaned generation permits an exclusively created new generation. |
| `FinalLstat`, `FinalRealpath`, `Complete` | `inspectSeedOwnership`, completed outcome append in `seedMountedTarget`. Fresh directory ownership proof follows cleanup. |
| `Crash`, `Resume` | Exceptions and explicit resume in both exported mounted adapters. Unreceipted or ambiguous state refuses. This model checks safety, not automatic recovery completeness. |

`seedMountedModule` and `seedMountedResearchProject` both reach this protocol through `seedMountedTarget`.
The old `createSeedOperation` remains a separate cheatsheet caller and supplies no mounted seed mutation authority after the repair.

## Abstraction decisions

The five safety promises and all bounds are unchanged. The creation model already described the proposed repair. Maintenance confirms its mapping against the merged source.
Maintenance also adds foreign bytes under identity tag 2. The creation model omitted that same-inode edit for second-generation files.
The existing three identity tags now each have a foreign-byte fault. This expands fault coverage within the original bounds.

The model's identities are exact abstract tags. The implementation stores bigint-derived decimal strings for device and inode, including an approved partial root's durable baseline.
Numeric observations in `publishSeedPlan` decide kind only. The model does not prove decimal parsing or numeric precision.
The compiled partial-root regressions exercise both adapters with an inode beyond numeric precision.

`readSeedJournal` now rejects coerced scalar enums, duplicate receipts, mismatched generations, unapproved file hashes, removal without ownership, and completion before cleanup.
The model starts after a valid durable journal start. Its transitions generate valid ownership events and model an ambiguous append tail as refusal.
It does not enumerate malformed JSON or prove parser completeness. The compiled journal lifecycle regression checks those new rejection branches.
Incomplete legacy journals refuse continuation. Completed legacy journals retain readback only and are outside the version 2 model.

The model's generation tags 1 and 2 correspond to implementation generations 0 and 1.
Removing a modeled receipt represents the durable removal intent plus the removed entry. The real journal retains both facts.
Its cleanup preflight requires the whole active inventory to agree before deletion, and resumed cleanup permits missing entries only through that representation.
The model can also recreate an empty claimed root or skip repeated identical observations where the implementation refuses or reproves it.
Those extra behaviors overapproximate safety. They do not establish that every model trace is a resumable implementation trace.
Repeated proofs inside one guarded operation add no environment step under the stated stable-path premise. They remain separate awaits in the source.

Final approved-byte readback and directory observations stay distinct from cleanup and completion.
The completion invariant records that readback occurred and that publication directory ownership still verifies after cleanup.
It does not assert that a file cannot change after its readback. Syscall swaps and concurrent writers retain expected counterexamples.

## Failure controls

Each positive invariant has its own broken model branch. Missing durable stage claims fail `ClaimBeforeStageEffect`.
Recursive unproved cleanup fails `NoForeignDeletion`. Bypassed ancestor proof fails `NoEscapedWriteAtGuardedBoundary`.
Adopting an occupied intended stage fails `NoAdoptionFromPathOrBytes`. Premature completion fails `CompletionRequiresVerifiedPublicationAndCleanup`.

The compiled schedule matrix crosses both adapters with seven stage faults, three live substitutions, five public interruption checkpoints, approved-partial targets, and completed repeats.
Every preservation check independently records device, inode, file size, SHA-256, link target, and missing paths before and after.
The cleanup mutation replaces the entire real `removeOwnedSeedStage` implementation with recursive removal in a disposable source copy.
The same `cleanup-foreign-child` schedules must then fail because the foreign sentinel disappears.
Restore the original source, rebuild, and require both schedules to pass.

The runner's covered-source diff is a drift alarm. It supplies no correctness proof.
