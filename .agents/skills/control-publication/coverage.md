# Control publication coverage

The exact product commit and SHA-256 map are in `coverage.json`.
Each runtime result records its compiled source copy, fixed-anchor addon, commands, child PIDs, fault markers and resulting bytes.
Public fixture loaders are separate from the production native loader. The release manifest binds their actual addon bytes.

## Source and observations

| Model action or property | Product source | Runtime observation |
| --- | --- | --- |
| `AnchorResolution`, `Gate`, `OneOwner` | `owner.ts withPublicationOwner`, native account resolver, `journal-mutation-owner.ts withJournalMutationOwner` | Concurrent first initialization and STOP-held owner refuse a contender. Namespace/gate mutants admit its effects. Fixture resolver has a fixed compile-time anchor. Production account discovery is excluded. |
| Ledger exclusive create, self-reservation, file sync and anchor sync | `store.ts openStore`, `append` | Separate before/after native create, append and barriers. Empty unclaimed ledger remains refused. |
| Namespace create, self-claim, claim sync and parent sync | `store.ts openStore` | Namespace creation before claim remains `bootstrap-unclaimed`. Claim-before-parent-sync retry checks actual synced directory identity. |
| `ExistingNamespaceClaimReplay`, `ReplayedNamespaceParentSync`, `ParentBarrierBeforeUse` | `store.ts openStore` existing claim branch | PP1 at `f9b7ad5` permits successful retry without an anchor barrier. Separate product fix `995226c` repeats parent barriers after claim revalidation. Namespace, catalog and nested-generation schedules require actual parent syncs on retry. The original counterexample remains retained. |
| Plan, stage and directory reservations/claims | `candidate.ts createCandidate`, `store.ts directory`, `stageObject` | Actual durable rows and individual append/sync boundaries. Created-but-unclaimed attempts remain retained; retries use fresh stages. |
| `RetryQuarantine`, `OrphanAppend`, `OrphanSync`, `FreshAttempt`, `NoUnclaimedUse` | `store.ts stageObject`, `abandonStage`, `publication.ts performPublication` | Four actual orphan append/sync interruptions preserve the unclaimed directory inode and leave it empty. Retry selects a different physical generation object and reads its complete bytes. |
| File create, physical claim, write guard/syscall, truncate, sync and readback | `store.ts write`, native `writeExact`, `guardInterval`, `guard` | Killed compiled CLI at each observed boundary. Recovered manifests are read byte-for-byte. Physical-claim mutant admits a same-byte foreign inode. |
| Promotion intent, guard, rename, both parent syncs and readback | `store.ts promote`, native `promote` | Separate syscall/guard traces. Foreign byte-identical regular output refuses under exclusive rename; exclusive-rename mutant overwrites it. Existing journey also retains foreign generation refusal. |
| `CallerRequest`, `ExpectedHeadResolution`, `InitialStaleRefusal`, frozen retry and complete graph | `index.ts publish` input, `publication-plan.ts freezePlan`, `publication-reader.ts resolveExpectedHead`, `readPlanFiles`, `publication.ts performPublication` | Caller `supplied` is immutable before anchor resolution and ownership. Resolved `expected` is captured from the owned current head only after comparison. Same-old-head counts use supplied expectation. Two fresh competing calls use unchanged absent expectations and no crash; B first refuses busy, then stale after A succeeds, without a plan or ledger change. The separate frozen-plan crash/retry remains. |
| New-request admission before `PlanAppend` | `publication-plan.ts freezePlan`, `controls/module-activity.ts validateControlTransition`, activity closure, preparation and evidence helpers | Prior matching requests still return their frozen plan first. New requests resolve the owned predecessor, validate the complete proposed transition and only then append. The Module activity public journey retains equal before/after ledger bytes for invalid initial enablement, history-rewriting adoption, protocol/history/check forgery and unsupported standing changes. |
| Shared canonical encoding and optional Module fields | `codec.ts`, `controls/canonical-json.ts`, controls and activity schemas | The canonical encoder, digest and base64 helpers moved to controls. Publication retains its event limit and failure mapping. The Module journey drives all three CLI and HTTP MCP actions and extracted current/pinned readers. Schema checks and focused domain cases cover the two optional fields without changing Generation 2's 18 roles. |
| Head reservation, create, claim, write, sync, intent, selector rename, parent sync and readback | `publication-settlement.ts prepareHead`, `settleIntent`, native `replaceHead` | Exact pending bytes survive kill after selector rename. Read-only inspect reports recovery and leaves ledger bytes unchanged. |
| Receipt reservation, write, sync, ready, promotion, parent syncs, readback and settlement | `publication-settlement.ts settleReceipt`, `store.ts temporary`, `promote`, `append` | Actual rows, exact receipt bytes and before/after append/barrier/readback schedules. Only settled results return public success. |
| Pending predecessor and request binding | `index.ts publish`, `publication-settlement.ts reconcilePending`, `publication-plan.ts freezePlan` | A selected without receipt settles before B's plan. Candidate, input, expectation and release rebinding refuse. Torn tail remains unchanged. Predecessor mutant admits B first. |
| Stable stream, safe event/offset/sequence limits | `store.ts load`, `requireAppendCapacity`, `limits.ts`, `event-envelope.ts`, native `readLedger`, checked offset helpers | Capacity tests check raw/base64/LF/receipt/suffix limits. Real native snapshot windows match actual public ledger bytes; growth, same-byte rewrite, replacement and unsafe offsets refuse. |
| Expiry, drain and release | `store.ts close`, native `expireAndDrain`, `owner.ts` callback, journal owner `finally` | Expired handle refuses mutation with unchanged public ledger. Actual delayed-cleanup mutant releases the gate before expiry and admits a contender; restored ordering refuses it. |
| CLI, MCP, extracted standalone | `command.ts`, `tools.ts`, `standalone.ts`, Operations dispatcher and package builders | Existing compiled public journey publishes CLI A/MCP B, reads extracted standalone current B/pinned A and checks exact retained-original/preferences bytes. |

All source names above are relative to `src/controls-publication` unless a different root is named.
Runtime `coverage` connects each observed operation/edge/record kind to the matching interrupted/recovered schedule.
Guards and syscalls have different edge names. A stopped syscall-edge marker is an actual compiled native observation, not a textual source match.

## Bounds and reductions

TLC explores two writers, two physical candidates and two request generations. An alias configuration maps both candidate names to one physical aggregate.
Each caller supplies absence or one of the two bounded head tokens before gate acquisition. Other digests cannot match either generated head and take the same initial stale-refusal branch.
Waiting at `Gate` represents a caller retry with unchanged input after the public busy refusal. The product does not provide an internal blocking queue or a liveness promise.
It permits one replacement, one crash/restart and one outstanding native effect.
One crash permits two stage attempts. A created-but-unclaimed attempt stays retained; orphan append, its barrier and the next reservation are separate actions.
Every record append/barrier, physical creation, claim, promotion, head and receipt phase is separate.
The representative file and intermediate directory stand for repeated tree operations. Runtime schedules exercise the complete generated graph.
Pending-predecessor model admission uses the protocol's permitted refusal branch. Real runtime schedules exercise settlement and request retry.
Modeled payloads pass complete graph and Module transition validation. These pure synchronous checks run under the existing owner before a new plan append.
Validation refusals change no modeled selector, request binding or publication plan. Public ledger readbacks establish the observed no-append cases.
The model has no Module history variables. It proves no record, assessment, closeout, evidence, dependency or unaffected-role preservation theorem.
Those properties rely on the source-bound Module runtime journey and pure rederivation checks, with synthetic data and bounded packets.
All real revision profiles still park native note or verified reuse prerequisites. Synthetic control-only completion supplies no academic truth or native artifact proof.
For an unclaimed intermediate file or directory, the model contracts the refused call and next retry into one quarantine segment.
The distinct writer can enter during the crash/restart gap before the resumed expected-head check. Orphan bookkeeping changes no selector or request binding.
Extra failed-call interleavings and power-loss persistence remain outside that reduction; no general implementation-equivalence claim follows.
The model records native guard admission and the following syscall separately. Same-process synchronous execution and no surviving child are explicit premises.
Replacement refusal stops the modeled request. Foreign-byte identity and native exclusive rename are established by compiled fixtures and mutants, rather than a theorem about the operating system.
The model does not model disk caches, filesystem crash persistence, SQLite internals, N-API memory safety, ACL evaluation, account lookup or distributed/hostile writers.
A claim record alone never establishes that its parent directory barrier completed.
MF1 corrected the earlier model that refreshed public expectation inside ownership. The frozen earlier run and root finding remain checkpoint evidence, not a complete P5 formal verdict.

## Historical counterexamples

Preserve both ordinary-sidecar-close counterexamples, the independently observed native-child lifetime counterexample and the predecessor-successor prototype counterexample.
The private handoff report names their original evidence paths and digests. They remain historical mechanism/prototype evidence.
The ordinary runner checks the seed skill's 23 exact source hashes without repeating its unrelated heavy suites.
That result is applicability only. Neither historical prototypes nor unchanged seed theorems establish publisher correctness.
