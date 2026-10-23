# Seed ownership coverage

This creation draft has no checked sync revision. `coverage.json` records that boundary.
The original source inspected was `fb381df4d0f5cbf8a4e9f2cca0e91bf8760378ea`.
Its stage writes and recursive removal break preservation. A green model of the proposed repair does not change that finding.

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

## Source mapping to reconcile after the repair

The selected protocol adds `src/mounted/seed-ownership.ts` and version 2 journal events.
The following mapping was read from the product author's implementation before its final exact-head review.
It is a review checklist until the sync revision is populated.

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
