---
name: seed-ownership
description: Check mounted seed ownership after changes to staging claims, publication ancestors, cleanup, interruption recovery, or seed journal events.
---

# Check seed ownership

A seed writes through proved directory identities and deletes only unchanged artifacts its journal proves it created.
Otherwise a retry can write outside its approved folder or delete unrelated academic bytes.

Creation status is `blocked`. The model describes the selected ownership repair, while `coverage.json` keeps its sync revision unset.
Finish the exact-head mapping and real-code mutation check before treating this draft as maintained verification.

## Run

Use Node 24 or later, installed repository dependencies, and Java 21.
Set `JAVA` if the Java 21 executable is not `java`.
On this Mac, it is `/opt/homebrew/opt/openjdk@21/bin/java`.
The runner downloads the pinned TLC 1.7.4 release and verifies SHA-256 before execution.
For offline use, set `TLA2TOOLS_JAR` to a copy of that release jar.

From the repository root, run:

```sh
node .agents/skills/seed-ownership/run.mjs
```

Read the printed `results.json` and each failed child log.
Require outcome `passed`, both positive models, five expected model counterexamples, two expected residual counterexamples, all compiled schedules, both real-code mutation failures, and both restored passes.
`model-only` is a partial result. A successful process exit alone does not complete this skill.
The runner retains source patches, exact heads, manifests, fixture journals, and TLC traces in a fresh OS temporary directory.
It uses synthetic Module and Research-project folders only.

## Read the claim

[The coverage record](coverage.md) maps actions to source and states the model bounds and environment assumptions.
[The machine record](coverage.json) names the last checked source revision.
TLC checks a bounded model. The compiled schedules and real-code mutation connect that model to the TypeScript implementation.
Their combined result is model safety plus implementation evidence.

Passing models assume one invocation and path substitutions between guarded operations.
Filesystem observation, creation, writes, syncs, journal persistence, and deletion remain separate actions.
The syscall-swap and concurrent-writer configurations must fail with their named counterexamples.
Treat those results as unresolved product boundaries, including concurrent resume tracked in #335.

## Maintain

1. Run the existing command and retain its outcome before editing verification.
2. Diff every covered file from `coverage.json` to the product commit. Read each intervening commit message. Search for moved functions and new writers of the same journal or roots.
3. Classify each change as no effect, model drift, an intended promise change, or a possible product bug. Update actions from source before rerunning.
4. Keep every filesystem await distinct. State any excluded state, environmental restriction, or reduced bound beside the result. Change a promise only with cited product evidence.
5. Run the command. For each failure, replay the trace against the source and classify it as model drift, product bug, or blocked execution.
6. Require the real cleanup mutation to lose the protected sentinel in both adapters. Require the exact `protected artifact manifest changed` assertion, then the restored passes. Source-text or digest failures do not demonstrate sensitivity.
7. Record `in sync`, `updated`, `bug`, or `blocked` for each check. Advance the sync revision only after the checked source and results agree. Keep verification upkeep in a separate commit from product repairs.

For a separate checkout, `--product-root` selects the exact committed product source while keeping these verification files.
`--evidence-parent` selects an existing parent beneath an OS temporary directory.
The normal command rejects covered-source drift and uncommitted changes.
