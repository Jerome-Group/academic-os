---
name: seed-ownership
description: Check seed, repair journal, and curation register ownership after changes to their mutation callbacks, identity keys, persistence, cleanup, or interruption recovery.
---

# Check seed ownership

A seed writes through proved directory identities and deletes only unchanged artifacts its journal proves it created.
Otherwise a retry can write outside its approved folder or delete unrelated academic bytes.
Curation commands retain every confirmed register append while cooperating writers share one canonical owner.

The checked product revision and maintenance outcome are in `coverage.json`.

## Run

Use Node 24 or later, installed repository dependencies, and Java 21.
Set `JAVA` if the Java 21 executable is not `java`.
On this Mac, it is `/opt/homebrew/opt/openjdk@21/bin/java`.
The runner reads its vendored standalone TLC artifact offline and verifies its exact SHA-256.
`TLA2TOOLS_JAR` may select another copy of those same bytes; other versions refuse.
[`vendor/README.md`](vendor/README.md) records the exact prerelease provenance and upgrade boundary.

From the repository root, run:

```sh
npm run seed-ownership:check
```

Read the printed `results.json` and each failed child log.
Require outcome `passed`, four positive models, seven broken-model counterexamples, and both residual counterexamples.
Also require both positive curation configurations and all four curation counterexamples.
Require four protocol prerequisites, 34 filesystem schedules, 33 journal protocol tests, and the repair provider probe.
Require nine curation CLI schedules, including actual register and journal readback and zero surviving child PIDs.
Require both cleanup mutation failures and restored passes, six owner mutation CLI failures and restored passes, and both repair mutation failures and restored passes.
Require bypass and early release each to lose a confirmed curation decision after both CLIs report success, then require both restored nine-schedule passes.
`model-only` is a partial result. A successful process exit alone does not complete this skill.
The runner retains source patches, exact heads, manifests, fixture journals, and TLC traces in a fresh OS temporary directory.
It uses synthetic Module and Research-project folders only.

To diagnose native TLC and Java temporary writes in the repository repair sandbox, set `JAVA` if needed, then run:

```sh
node .agents/skills/seed-ownership/java-temp-probe.mjs
```

The probe uses the actual repository sandbox arguments and retains a fresh owned sibling fixture.
It requires default and outside-temp extraction refusals, owned-temp TLC execution, and all 19 runner model outcomes.
It also requires native Java outside-write, TCP listener and outbound connection refusals, and zero surviving child PIDs.
Its runner result remains `model-only`; passing this diagnostic does not complete the formal runtime and mutation gate.
The former 1.7.4 RMI listener refusal remains historical blocked evidence and is not a successful model run.
The diagnostic uses the Java source launcher, so it requires the Java 21 JDK.

For tool admission and manifest-neighbor controls, the JDK's `javac` and `jar` must accompany `JAVA`.
Run `node --test .agents/skills/seed-ownership/tlc-toolchain.test.mjs`.
Set `TLC_OLD_JAR` to an existing 1.7.4 artifact to include its real pre-model refusal alongside changed-byte refusal.

## Read the claim

[The coverage record](coverage.md) maps actions to source and states the model bounds and environment assumptions.
[The machine record](coverage.json) names the last checked source revision and binds every covered file to its SHA-256.
[Curation coverage](curation-coverage.md) maps its distinct append order, identity key, bounds, and exclusions.
The ordinary run compares exact source bytes, so a squash merge does not require the original product commit object.
TLC checks a bounded model. The compiled schedules and real-code mutation connect that model to the TypeScript implementation.
Their combined result is model safety plus implementation evidence.

The filesystem model assumes one journal owner and path substitutions between guarded operations.
Filesystem observation, creation, writes, syncs, journal persistence, and deletion remain separate actions.
The syscall-swap and concurrent-writer configurations must fail with their named counterexamples.
The uncontrolled-writer counterexample describes a missing owner, rather than the guarded public apply path.
The separate owner model checks two processes sharing one journal and two processes using independent journals.
Its kernel exclusion and process-death release are premises connected to compiled process tests, not proofs of SQLite or the operating system.

## Maintain

1. Run the existing command and retain its outcome before editing verification.
2. Diff every covered file from the recorded revision to the product commit. Fetch that historical revision if absent; if unavailable, record the blocked history inspection. Read each intervening commit message. Search for moved functions and new writers of the same journal or roots.
3. Classify each change as no effect, model drift, an intended promise change, or a possible product bug. Update actions from source before rerunning.
4. Keep every filesystem await distinct. State any excluded state, environmental restriction, or reduced bound beside the result. Change a promise only with cited product evidence.
5. Run the command. For each failure, replay the trace against the source and classify it as model drift, product bug, or blocked execution.
6. Require the real cleanup mutation to lose the protected sentinel in both adapters. Require the exact `protected artifact manifest changed` assertion, then the restored passes. Source-text or digest failures do not demonstrate sensitivity.
7. Require owner bypass and early release to admit real competing CLI calls. Inspect each retained `loser.json` and its trace. Require both repair mutants to repeat the fake provider operation, then require every restored check to pass.
   For curation, inspect both child reports, final register bytes, both intent/result journals, and the two final-prefix digests. Require a lost confirmed migration under each mutant, followed by restored passes.
8. Record `in sync`, `updated`, `bug`, or `blocked` for each check. Advance the sync revision only after the checked source and results agree. Keep verification upkeep in a separate commit from product repairs.

For a separate checkout, `--product-root` selects the exact committed product source while keeping these verification files.
`--evidence-parent` selects an existing parent beneath an OS temporary directory.
The normal command rejects covered-source drift and uncommitted changes.
During maintenance, `--candidate-revision <full-product-HEAD>` runs a clean candidate and captures `sourceHashes` without changing the record.
After that full run passes and its source mapping agrees, advance the revision and copy those exact hashes into the record. Commit the verification, then run the ordinary command from the clean checkout.
Each schedule batch runs in a fresh Node process so restored builds cannot reuse mutated imports.
