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

## Native host policy maintenance

`code-model-map.json` binds eleven properties to the final source functions, exact blobs and public drivers. Existing workflow109 history, publisher bounds, invariants and all original mutation/boundary obligations remain. `MixedAdmission` adds finite shared namespace, full-history-before-success/effects, completed-before-pending, runtime-before-account and full-suffix ordering. Both new writers use one selected starter family per run. Retained owner classes cover cross-family and internal-bridge collisions. It does not model two simultaneously distinct new writer families.

`NativeSelectorMove` adds one updater and one historical readonly caller, one new and old selector, foreign/false-location identity classes, three attempts and two process crashes. Its initial prefix also permits two already retained attempts. Every modeled append, file barrier, create, claim, write, selector swap, archive, archive observation and move observation is separate. Generation and receipt promotion remain separate from selector installation. Restart continues the source-defined outstanding operation after supported replay and resync. This assumes retained process-crash bytes, not persistence through power loss. The generation/receipt prefixes have no modeled physical object identity. Their unknown-inode recovery remains an original generated-proof and actual runtime premise. Fixed-head readonly lookup is outside this interrupted-read reduction.

The normal run adds three positive configurations and eight shortest intentional counterexamples. `native-runtime.mjs` removes the actual namespace, suffix, pending-order, complete-location, move-order, expected-old, receipt-completion and artifact-digest guards. Each requires its predicted public wrong result or persisted state, exact source restoration and the corresponding restored control. Source hash drift or setup failure never counts as sensitivity. The unique-pressure fixture remains retained after the wrong starter. Restoring its guard never rewinds its ledger or removes its residue. The receipt mutant also runs the actual production builder, tar archive and extracted installer. Only its declared account adapter, addon and native-digest metadata change after extraction. Both bundles and scanner bytes remain exact.

Public product fixtures cover complete canonical history, scoped v2 move lineage, required same-bridge archive observation, pending-only predecessor readback, all four registration/policy swap/archive interruptions, generated CLI/HTTP MCP/standalone compatibility, signed nanoseconds, authority isolation and installed transitive/non-JavaScript/resolution inputs. A changed dependency can execute during trusted bootstrap before consistency refusal. This is installed consistency before account entry, not malicious-bootstrap authentication.

Capacity uses the actual production planners and replay allocator, not a second allocator implementation. An observation adapter exposes the existing planner's records and compares unchanged outputs to production exports. Registration reserves49 rows, policy70, each including six move rows across three attempts. One repeated-history and one unique-pressure group run per full check. The source-profile arithmetic charges16704 bytes per row, eighteen membership units and32 reference slots. The final helper has at most eleven simultaneous memberships and nine relevant whole-history arrays. Fixed/sparse floors require11136 bytes, within11648 charged at two rows. These bounds assume supported Node/V8 layouts, stated allocation/growth costs and reclamation of unreachable query generations. Decoder/encoder, native, planning and caller workspaces remain separate. No total heap/RSS theorem follows.

Even perfect sharing permits at most16070 rows before retained nodes. Older over-budget history may refuse before completed lookup. Generated retries retain no new attempt ceiling. Each admission reserves the next complete successful path and existing orphan obligations; infinitely repeated interruptions can exhaust finite resources and leave retained recovery. Native payload acquisition453, Module/corpus preservation, infinite completion and unlimited historical accessibility remain outside this claim.

P4 requires a sound pending classifier. `UnrelatedPendingHasNoFreshStarter` asserts the consequence under the abstract pending predicate. Family-tagged settlement classification remains runtime-checked. The retained `569cf9e` issue481 counterexample makes a pending generated request ID equal a settled native host intent digest, then admits unrelated host registration. The corrected-source public regression must refuse it with unchanged history. This finite model does not independently verify the classifier implementation.

Source-order maintenance distinguishes immutable promotion's source-parent barrier, destination-parent barrier and destination readback before observation. Both blobs then perform final owned read, file sync and parent sync. Only policy appends a native generation settlement and selector intent. Registration skips those rows. Selector move observation is followed by its own owned read before native settlement. Policy receipt settlement is followed by a separate owned read before success. The intentional move-order break omits only move-intent append/sync; archive intent and physical expected-old guards remain enabled.

## Direct Google Tasks applicability

Normal calls without `plan_json` delegate to existing Google Tasks provider and generated Task-register operations.
They do not acquire control-publication ownership or alter its ledger, claims, candidates, heads or receipts.
The explicit-plan branch and modeled properties and bounds remain unchanged.
`taskDirectMaintenance` records the one changed source binding and preserves historical proof provenance.
This applicability update claims no fresh complete formal-suite pass or broader ownership theorem.

The delivery integration also updates capability metadata and binds both changed executing sources.
The 162 remaining publisher bindings and all 23 seed bindings remain unchanged.
An ordinary complete run on the integrated source is required before delivery.

## Shared scanner applicability

The retained ordinary native-policy proof on `3f8e5429c010de152d32b0215f6a7e16caa7e7ea`
discharges the preceding integration requirement. Its 164 source bindings, 21 model cases,
16 mutant families and 115 interrupted schedules remain historical proof at that revision.
`sharedScannerMaintenance` records its result digest and the subsequent scanner-only comparison.

Scanner integration changes seven covered files and adds eight source/test bindings. The formatter
delegates read-only filesystem observation to `scan-core.c` through the C header. The TypeScript
loader checks the ordered three-source v2 binding before executing the helper. The supported v1
route requires the pinned legacy formatter hash. Builders copy the new sources and label them as
`scanner-source`; installed inventory and digest checks run before account resolution. The source
map records the actual functions, blob identities and symbol occurrences.
The source-map guard compares every declared symbol occurrence with the current file before TLC
or runtime work. It also checks each mapped source hash. These are navigation checks, not semantic
correspondence. Issue 488 retains the inherited M1 location drift that motivated this guard.

No modeled owner, request, ledger, selector, receipt, planner or replay transition changes.
The models, properties and bounds remain byte-identical. `RuntimeArtifactValidation` still represents
the complete installed-input check; it does not prove the enumerator, digest implementation or scanner.
The new source closure therefore needs fresh runtime sensitivity, not an invented scanner theorem.
Public discovery checks the C++ callback consumer, bounded fragments, callback stop and descriptor
recovery, source changes, native metadata and public inventory. The supplemental scanner-binding
journey checks malformed ordered bindings and exact restoration through a physically copied CLI.
Host and actual produced/extracted package tests check core/header change and absence refusals,
unchanged production scanner bytes, restored installation and historical retry.
The formal fixture copier and retained artifact hashes also include the core and header in both
layouts. The package receipt driver compares those bytes after extraction. A selected early-receipt
mutant and restored package control exercise these maintained drivers without replaying all schedules.

Read-only scans may advance access times; optional inventory logs create private external files.
Neither acquires publication ownership. Arbitrary hostile races, native memory safety, exhaustive
callback behavior, device/dataless fixtures, acquisition and preservation remain outside this claim.
The prior full schedules are source-applicable evidence, not a newly executed complete scanner run.

## Versioned Module control applicability

`moduleVerificationMaintenance` binds the approved Module change and its executing validation closure.
The source set grows from 172 to 202 files. Seventeen inherited bindings change, and 30 are added.
The 44 local execution inputs include 13 previously implicit helpers whose bytes remain unchanged.
Schema sources, generated declarations, CLI reporting and relevant fixture dependencies are also bound.
Every mapped symbol has its current hash, Git blob and literal line occurrences.

The registry supports 20 role/schema pairs across the same 18 roles. Only verification and learning
records gain v2 alternatives. The seven prior control, activity and publication schemas remain exact.
Generated filenames, request identity widths and head contract version 8 remain unchanged.
V1 inspection keeps its output shape. V2 reports verification as `not-implemented`.

The new checks validate canonical references, declared source bindings, fragment hash contradictions,
known local decision scope and numeric assessment structure. They add diagnostics before a new plan
append. Matching retries retain their original binding and settlement path. No owner, ledger,
selector, receipt or recovery transition changes, so all three models and their bounds remain exact.
Module record preservation and assessment semantics remain runtime obligations outside these models.

Replay accounting keeps its 16704-byte row charge and conditional 18-membership/32-slot profile.
The eight mixed-history maps/sets, pending settled set and two store caches remain unchanged.
Generated, host and policy settlement keys remain at most 90, 80 and 78 code units within 256 charged.
Pending descriptors still have three properties within four charged. The unchanged native planner
reserves 49 registration rows or 70 policy rows, including six selector-move rows.
Generated completion iterates actual plan files and dependencies, including their encoded bytes.
It has no fixed role-count allocation shortcut or added attempt ceiling. New validation temporaries
are outside the replay account, which proves neither total heap usage nor unlimited history access.

Fresh discovery and Module activity drives check public CLI, HTTP MCP, unchanged refusal inputs,
ledger snapshots and current/pinned readers. Produced-package readbacks retain exact executable
bundles and scanner core/header bytes under declared fixed-account fixture adaptations.
Six rich assessment variants have pure transition preservation/refusal evidence only; native-source
admission remains closed. Structural checks establish no extraction provenance, rubric truth,
grading accuracy, mathematical proof, verification execution or accepted evaluation.
The 21 bounded model cases and stale-symbol negative control supplement the retained native full
proof. A model-only run remains incomplete and exits 1. The 115 crash schedules and 16 actual-code
mutant families are historical evidence at their recorded revision, not fresh Module execution.
