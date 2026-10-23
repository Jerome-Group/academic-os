# Seed ownership coverage

`coverage.json` records the last successful product revision. A candidate run leaves that record unchanged until every gate passes.
Its exact covered-file SHA-256 map binds ordinary execution to those bytes independently of Git object reachability after squash landing.
The recorded revision still identifies the inspected history. Hash equality detects source drift; it supplies no model or implementation proof.
The earlier inspection reconciled #340 through `64dfe99bcca15c13e9c49ab385da71656b857d1e`.
This inspection extends through `2d000f1a79e33c0178379abe247588b682242e67`.
`787dc825fff9379c990f0e3680492b972125799a` wraps the seed apply before observations and replaces unrestricted repair append with a bound mutation session.
`2d000f1a79e33c0178379abe247588b682242e67` folds journal basenames in the lease key while preserving approved data identities.
Both expand the promise intentionally under [ADR-0041](../../../docs/adr/0041-resumable-journals-have-one-mutation-owner.md).
`33be90f90aefa2d0e801635d45dbab1b3757cab7` hardens repair scalar parsing, and `8c8fba5ca85cc45eef16bbeeec5579e216190c0b` verifies retained recovery during inspection.
Those two changes do not alter the owner protocol. Parser completeness and recovery correctness remain outside its model.
The existing seed state machine and every covered seed file except the outer wrapper are unchanged.

## Containment maintenance

Inspection extends through `d726ae44dc433f932f0f561d74f55d8d073af011`.
The covered changes since `2d000f1a79e33c0178379abe247588b682242e67` are classified as **No effect** on the ownership properties.
`6aee8dac8cf52c477dcc37ce4755e90a035395f1` corrects the shared containment predicate.
`d726ae44dc433f932f0f561d74f55d8d073af011` routes repair snapshot and local-artifact preflight through it.
Both compare an exact parent component instead of rejecting every two-dot-prefixed ordinary name.
The helper is now a covered file because those checks moved out of the covered CLI file.
This binding detects future source drift; the model still begins with a valid approved plan and does not prove preflight path policy.
The owner callback, storage admission and drain, effect ordering, filesystem transitions, properties and all bounds are unchanged.

The initial ordinary run refused the changed CLI source hash, which was verification drift rather than a failed ownership property.
The explicit candidate at the recorded revision passed all 13 model runs, 34 adapter cases, 33 ownership tests and four prerequisite tests.
The cleanup mutations still deleted foreign sentinels, owner mutations still let six losing CLIs complete, and repair mutations still duplicated creation.
Restored implementations passed those same controls.
The candidate runner also used the separate evidence-parent containment correction tracked by #362; that correction changes no protocol check.

## Bounds and assumptions

The positive configurations enumerate one target, one active stage pathname, two claim generations, two nested directory components, two approved files, and one foreign descendant slot.
Each entry has three identity tags, plus absence. Kinds are ordinary directory, file, link, or absent.
File bytes are approved, empty, partial, or foreign. Directory identities are abstracted per pathname and generation.
Each run permits two environment faults, one process interruption, and one explicit retry.
Absent and approved-partial targets run separately. Safety has no fairness or liveness premise.

One seeder owns the journal in the filesystem model. Environment faults occur only before guarded operations, cleanup scans, or resumed invocations.
During a checked operation, the environment preserves the paths under inspection and mutation.
This is an environmental restriction, not atomicity supplied by Node.
The `syscall-swaps` configuration permits faults at every active program counter and must expose an escaped write.
The separate uncontrolled two-writer model must expose duplicate journal sequence numbers when the owner is absent.

The model begins with an approved plan and a durable, valid journal start containing approved existing directory identities.
It models later durable event prefixes and an ambiguous append tail separately.
Private journal allocation, baseline capture, complete contract semantics, and mount materialization are prerequisites outside this initial model.
All modeled ordinary entries are materialized. Failed observations refuse.
The configured parent remains trusted and stable outside the modeled trees.
The stage pathname denotes the active generation. Earlier cleaned UUID paths are outside the live tree.
The foreign slot abstracts an unknown descendant without enumerating arbitrary names.

Process interruption between awaits retains filesystem effects and durable receipts.
Interruption during file writing can leave partial bytes. An append without its completed sync can leave an ambiguous tail and refuse retry.
No claim follows about power loss, inode reuse, native descriptor-relative operations, a live Drive mount, credentials, or academic recovery.
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
It does not assert that a file cannot change after its readback. Syscall swaps and uncontrolled concurrent writers retain expected counterexamples.

## Journal owner composition

`JournalMutationOwnership.tla` adds two processes and two journal keys without multiplying the filesystem model's state space.
One configuration shares a journal. The other assigns one journal to each process.
Each process has one callback, with one possible process crash and one explicit restart across the run.
Each callback has a representative operation append and a final outcome append, or one detached storage append admitted before callback settlement.
The model preserves separate read, staged effect, publication effect, append open, write, sync, close, cleanup, verification, expiry, drain, rollback, and SQLite close actions.
The detached append also separates its journal read, directory creation, file open, write, sync, close, directory open, directory sync, and directory close.
The optional directory sync overapproximates first-record durability work. It grants no additional mutation authority.
The original filesystem model still supplies the detailed directory, file, claim, receipt, cleanup, and interruption transitions inside a seed callback.
An outer phase represents a location within that callback. It does not make the inner filesystem awaits atomic.

| Owner actions | Source boundary |
| --- | --- |
| `Acquire`, `Busy` | `withJournalMutationOwner` dynamically loads `node:sqlite`, validates the canonical state root and private namespace, then synchronously executes `BEGIN IMMEDIATE` with timeout zero. Failed acquisition never enters the callback. Namespace creation is allowed before acquisition. |
| `IdentityLstat`, `IdentityRealpath` | The post-acquisition `requireCanonicalAncestry` loop observes metadata and canonical identity separately. The model represents one component pair; other stable components repeat that pair. |
| `Read`, `Staging`, `Publication` | `seedMountedTarget` enters `inspectAndSeedTarget` only inside the owner callback for apply. `ensureMaterialized`, current-state reads, journal reads, stage reconciliation, creation, and publication remain inside that callback. Preview selects the read-only branch. |
| `JournalOpen`, `JournalWrite`, `JournalSync`, `JournalClose`, `Cleanup`, `Verification` | `appendSeedJournalEvent`, `removeOwnedSeedStage`, final directory proofs, final outcome append, and report resolution all settle before the callback returns. Existing filesystem-model actions keep the individual awaits. |
| `Read` and effect locations for repair | `executeRepairPlan` calls `journal.mutate` before `journal.read`, inventory, recovery, local retirement, provider calls, verification, or outcome persistence. The model checks the owner interval only. It does not verify those operations' business semantics. |
| `AdmitPending`, `Expire`, `PendingRead` through `PendingDirectoryClose`, `Drain` | `createFileRepairJournalStore` binds one canonical path and change-set identity. `admit` tracks each storage promise. Callback settlement closes admission; `Promise.allSettled` drains unfinished work before the outer callback settles. Already handled failures keep the existing recovery behavior. |
| `Rollback`, `Close` | The helper's nested `finally` releases the empty transaction and closes SQLite after callback settlement and pending drain. Errors remain operational failures. |
| `Crash`, `Restart` | Process death releases the kernel owner while preserving the JSONL prefix. A successor re-reads before effects. SQLite sidecars remain permanent; no stale-file unlink transition exists. |

`ExclusiveCallbacks` checks one admitted callback per journal.
`OwnerThroughCallback`, `ReadRequiresOwner`, and `EffectsRequireOwner` check lifetime coverage, including pending storage after expiry.
`UniqueSequence` checks sequence uniqueness under serialized prefix reads.
`FreeJournalAvailable` checks that a free journal's acquisition remains enabled while another journal is held.
`CrashClearsOwner` checks immediate kernel-owner release in the assumed process-death semantics.
`ExpiredSession` checks that a settled callback cannot return to new storage admission.
These are safety and enabledness checks. They establish no scheduler fairness or automatic recovery completeness.

The owner abstraction assumes cooperative callers, one host, the same configured canonical state root, stable private paths, and reliable local SQLite locking.
It assumes SQLite alone owns every descriptor for the sidecar, including constructor/bootstrap and transient companion handling.
Canonical journal basenames share a case-folded lease key; approved IDs and JSONL paths retain their spelling.
Raw descriptor closes, pathname replacement, copied state roots, other SQLite implementations in one process, network mounts, and multiple hosts can invalidate those premises.
The compiled tests retain both deliberate descriptor-close counterexamples.
Metadata rejection, constructor-crash recovery, same-process busy close, cold multiprocess acquisition, stopped owners, observed death, and independent journals are implementation evidence.
They are not a theorem about SQLite, POSIX locks, operating systems, or provider transactions.
The model assumes a parseable current JSONL prefix and does not prove parser completeness or power-loss persistence.
Existing ambiguous histories still refuse. No history is renumbered.

The expanded covered-source list includes the shared helper and the seed and repair entry, storage, export, and CLI wiring boundaries.
Configuration loading, approved-plan validation, configured-root resolution, and repair mount/snapshot metadata preflight precede those entry boundaries.
Those observations are outside the owner model. Continuation reads, provider requests, mounted mutations, and repair effects remain inside it.
Search found no additional caller of the helper and no remaining unrestricted production repair append API.
The cheatsheet-only `createSeedOperation` remains outside mounted seed authority.
Calendar promotion, pinned updates, routines, unrelated journals, provider implementations, and full repair recovery correctness remain outside this claim.

## Failure controls

Each positive invariant has its own broken model branch. Missing durable stage claims fail `ClaimBeforeStageEffect`.
Recursive unproved cleanup fails `NoForeignDeletion`. Bypassed ancestor proof fails `NoEscapedWriteAtGuardedBoundary`.
Adopting an occupied intended stage fails `NoAdoptionFromPathOrBytes`. Premature completion fails `CompletionRequiresVerifiedPublicationAndCleanup`.

The compiled schedule matrix crosses both adapters with seven stage faults, three live substitutions, five public interruption checkpoints, approved-partial targets, and completed repeats.
Every preservation check independently records device, inode, file size, SHA-256, link target, and missing paths before and after.
The cleanup mutation replaces the entire real `removeOwnedSeedStage` implementation with recursive removal in a disposable source copy.
The same `cleanup-foreign-child` schedules must then fail because the foreign sentinel disappears.
Restore the original source, rebuild, and require both schedules to pass.

The owner model has two additional broken branches.
Bypassing acquisition must violate `UniqueSequence`; early release must permit overlapping callbacks and violate `ExclusiveCallbacks`.
The compiled owner suite runs 33 synthetic tests, including the actual Module and Research CLI at read, staging, publication, cleanup, and final outcome sync.
Raw child exits, mounted manifests, JSONL bytes, traces, provider counters, stopped owners, observed process death, and successors remain in the evidence tree.
The owner bypass mutation replaces the real helper with an unowned callback.
The early-release mutation rolls back and closes SQLite before invoking the callback.
Both adapters' read contenders must actually exit zero and complete under bypass.
Both adapters' cleanup and final-sync contenders must actually complete under early release.
Each mutation also runs the independent repair probe, which must fail `competing repair performed provider effects` after repeating `create-admin`.
Restored source is rebuilt and all six selected CLI cases plus both repair probes must pass.

The runner's covered-source diff is a drift alarm. It supplies no correctness proof.
