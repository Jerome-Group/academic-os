# Curation register ownership

`CurationRegisterOwnership.tla` checks that a confirmed append stays in its register and that replacement never uses a stale captured prefix.
Otherwise two curation commands can each report one successful append while the second rename discards the first decision.
This is a separate state machine because curation writes intent before target reproof and replacement.
The seed and repair models retain their original order, properties, configurations, and bounds.

## Source and history

The inspection runs from `d726ae44dc433f932f0f561d74f55d8d073af011` through `4bde27955b2fb250adf7d9bac778f0068ea71567`.
All 13 previously covered files retain identical bytes, despite intervening squash commit messages in `55ed6c06cc2d2eca2ee99855fbb4ae5cdad1bcea` and `359061e45338f9eda4783a5c1d7fca2074c184c7`.
Those checks are in sync. The former coverage statement that the helper has no additional callers is stale.
`4e72cfd9282d6b2fd8dd00385ebb09afa37bccce` adds Shelf ownership.
`15b71cd7cc6f19711df2862f298e11b635ee1aee` adds weekly publication ownership, later extended by `78f350b029c5e7b39522244a55b42e5df60097f3`.
`359061e45338f9eda4783a5c1d7fca2074c184c7` adds Calendar receipt ownership.
Those caller semantics remain excluded. The shared helper's proof alone does not verify them.

`4bde27955b2fb250adf7d9bac778f0068ea71567` intentionally extends curation's append-only promise to competing commands.
Its message identifies the lost-decision counterexample and requires ownership through replacement, readback and durable journal settlement.
Both execution callers now pass the resolved cohort `stateRoot` into `appendProvedRegisterLines`.
The whole-cohort proof still completes outside ownership before any register write.
The new model and compiled controls update a missing verification description. No existing property changes wording or becomes weaker.

## Identity and owner interval

For canonical module root `M`, the ordinary-file and containment proof returns `T = realpath(join(M, writtenControlPaths.curationRegister))`.
The logical owner path is `join(stateRoot, "curation-registers", sha256(T.toLowerCase()) + ".jsonl")`.
The shared helper resolves the state root, validates ancestry and derives its permanent SQLite sidecar from that canonical logical path.
Successful `BEGIN IMMEDIATE` admits one callback. Busy or unavailable acquisition returns before lazy run-journal opening.
The register's logical identity survives replacement of its inode. The owned reproof compares the canonical target again.
Mount and state symlink aliases therefore use the same owner under the canonical configuration premise.
Case folding can serialize distinct case-only paths on a case-sensitive filesystem. It supplies conservative exclusion rather than extra concurrency.

The callback awaits intent persistence, fresh register and input proof, initial digest read, temporary creation, write, sync, close, final digest read, rename, readback, and result or refusal persistence.
Only after callback settlement does the helper roll back and close SQLite.
No detached curation append escapes this interval. `openRunJournal.append` awaits file write, sync and close.
Different configured state roots do not cooperate through one owner and are outside the claim.

## Action mapping

Each transition represents one await and its adjacent synchronous branch, or one synchronous lock operation.
The `Steps` table advances one pair at a time. It never combines successive awaits into one action.
Pure control transitions may stutter relative to source execution.
When the owned register digest disagrees, the model proceeds to refusal before the redundant input checks that the source still awaits.
Those omitted reads grant no mutation authority and remain inside the real callback. They do not become an atomic operation in the model.

| Actions or program counters | Committed source boundary |
| --- | --- |
| `Observe` | A valid public observation supplies the planned register digest. Observation parsing, planning and configuration validation are premises. |
| `cohort-lstat`, `cohort-realpath`, `CohortRead` | Initial `proveRegister` in `appendProvedRegisterLines`. Metadata, canonical identity and digest reads remain separate. A changed digest refuses. |
| `source-lstat`, `source-read`, `artifact-lstat`, `artifact-read` | Initial `unprovedInputs`, using `hashSource` for one present source and one present artifact. These finish before `Acquire`. |
| `Acquire`, `Busy` | `withJournalMutationOwner` executes synchronous `BEGIN IMMEDIATE`. Private namespace setup precedes acquisition and is excluded, rather than declared atomic with it. |
| `identity-lstat`, `identity-realpath` | One component of post-acquisition `requireCanonicalAncestry`. Additional stable components repeat these observations. |
| `journal-mkdir`, `intent-open`, `intent-write`, `intent-sync`, `intent-close` | Lazy `openCurationRegisterJournal` calls `openRunJournal`, then `journal.append(intent)`. Each filesystem await advances separately. |
| `owned-lstat`, `owned-realpath`, `OwnedRead` | Fresh `proveRegister` inside the callback. Stable canonical identity is a premise. Digest mismatch records refusal. |
| `owned-source-lstat` through `owned-artifact-read` | Fresh `unprovedInputs` inside the callback. One present source and artifact remain unchanged in this bounded model. |
| `ReplacementRead`, `temporary-open`, `TemporaryWrite`, `temporary-sync`, `temporary-close`, `FinalRead`, `Rename` | `replaceMountedFile` checks initial digest, exclusively creates one private temporary, writes, syncs, closes, checks final digest, then renames. Each awaited effect is separate. |
| `Readback` | `writeRegister` reads the published register and compares its intended digest. |
| `result-open`, `result-write`, `result-sync`, `ResultClose` | Awaited `journal.append(result)`. Confirmation requires the result append's close to finish. |
| `refused-open` through `refused-close` | Awaited `journal.append(refused)`. The model omits temporary unlink on refusal because private temporary contents grant no publication or mutation authority. |
| `Rollback`, `close` | The shared helper's nested `finally` releases the transaction and closes SQLite after callback settlement. |

`CurationAppendPreserved` requires the original prefix and every confirmed writer's appended decision to remain present.
`CurationNoStaleReplacement` records any rename after another writer changed the captured prefix.
The latter property separates the final digest read from rename. Ownership supplies the exclusion between those awaits.

## Additional bounds and premises

Two processes each attempt one append. Each has one planned digest, one unique appended decision, one source, one present artifact, one temporary and one private run journal.
Registers begin with a symbolic prefix. Digests use exact sequence equality, with collision freedom assumed.
One configuration maps both processes to one canonical register key. The other gives each an independent register and key.
All operation orders inside these bounds are explored without fairness or liveness assumptions.
The curation model adds no interruption, retry, I/O exception, pathname fault, missing-artifact branch, or uncooperative writer.
It does not reduce any existing seed or journal-owner bound.
The existing owner model retains its process-death, restart and pending-storage checks.
The nine real curation CLI schedules separately exercise stopped owners, observed death, published interruption, stale observation, aliases and unavailable ownership.
Those schedules supply implementation evidence, not exhaustive interruption proof for this curation model.

Stable canonical namespaces, materialized ordinary files, one host, one canonical private root, unchanged source and artifact inputs, and reliable local SQLite exclusion are premises.
Public observation and all configuration, planning, parser and contract correctness are outside this model.
Journal bytes are represented by ordered open, write, sync and close locations, not a complete JSONL parser or persistence model.
No claim covers power loss, filesystem or SQLite implementation correctness, arbitrary writers, cloud synchronization, copied private roots, live Drive, native credentials or academic recovery.
The symbolic prefix checks preservation of the original history. It does not prove arbitrary JSON encoding or byte newline policy.

## Failure controls and implementation evidence

Both bypass and early release must violate each new invariant in separate TLC configurations.
Bypass admits both callbacks without an owner. Early release admits a second callback while the first remains active.
The decisive trace has both final reads accept one prefix, A publish and confirm its append, then B rename its stale replacement and discard A.
The compiled CLI schedule makes the same mutation in a disposable copy of the actual shared helper.
It holds migration and rederivation at their final digest reads, settles migration first, then releases rederivation.
Both CLIs must exit zero and report `appended=1`, both private journals must contain intent and result, and final register bytes must lack the confirmed migration while retaining rederivation.
The runner checks both final-read digests, rereads the actual register and journals, and requires every recorded child PID to be absent.
Curation fixtures use `owner-curation-*` evidence directories so the existing CI artifact globs retain their raw JSON and JSONL files.
An exception, source hash mismatch or compilation error does not satisfy this control.
After restoring the helper and rebuilding, all nine CLI schedules must pass for each mutation.
The fresh ordinary run follows only after candidate gates pass, the exact source hashes are recorded and verification is committed.
