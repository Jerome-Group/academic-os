---
name: verify
description: Verify Academic OS CLI, Operations and authored workflows through the existing capability index and isolated fixture journeys. Use after behavior changes or when auditing verification coverage.
---

# Verify Academic OS

## Launch

Run from the repository root with Node 24 or later in a dedicated verification shell.

```sh
npm ci --ignore-scripts
npm run build
aos_proof="$(mktemp -d /tmp/academic-os-proof.XXXXXX)"
chmod 700 "$aos_proof"
mkdir -m 700 "$aos_proof/fixtures"
export TMPDIR="$aos_proof/fixtures" TMP="$aos_proof/fixtures" TEMP="$aos_proof/fixtures"
git rev-parse HEAD > "$aos_proof/revision.txt"
git status --short > "$aos_proof/working-tree.txt"
node dist/src/cli.js capabilities index --json --log "$aos_proof/index.json" > /dev/null
```

Ready means the build succeeds and the index contains actions, profiles and workflows.
These are short-lived CLI processes. The temporary-directory environment contains fixture state inside this run's owned directory.
Do not run builds or drives concurrently in the same checkout. Use separate worktrees for other agents.
There is no server to stop after a normal CLI run.

## Doctor

Before each feature drive, capture a fresh `capabilities health` observation.

```sh
node dist/src/cli.js capabilities health --json --log "$aos_proof/health.json" > /dev/null
```

Require the `node` and `npm` entries to have outcome `passed`.
Choose a new log filename for every observation. Logs refuse replacement.
Read only the relevant actions and health entries from the saved logs. Keep full payloads out of chat.
Teaching release verification and the full profile also require the installed TeX and Poppler tools.
Require passed health for `latexmk`, `kpsewhich`, `pdfinfo`, `pdffonts`, `pdftotext`, `pdftoppm` and `pdftohtml` before claiming release verification.
Missing tools are prerequisites to resolve or report, not successful verification.
Before full or formal verification, follow [the formal skill](../seed-ownership/SKILL.md).
Confirm Java 21 through `JAVA` or `PATH`, pinned TLC availability, a clean committed checkout and matching covered-source hashes.
Java invocation success alone does not establish its major version. The runner checks the version and TLC checksum.
Health does not validate credentials, live providers, launchd, maintenance recovery or document quality.
After a failure, doctor again and use a fresh disposable fixture for retry; retain the failed evidence.

## Drive

Read [the feature index](features/README.md), then drive the relevant feature file.
The public commands own selection, isolation, timeout and structured outcomes.

```sh
node dist/src/cli.js capabilities verify --workflow discovery --json --log "$aos_proof/discovery.json"
node dist/src/cli.js capabilities check --profile full --json --log "$aos_proof/full.json"
```

Run every workflow during maintenance. A changed feature needs its specific journey first.
Use `actions[].tests` in the captured capability index to locate the assertions and entry points.
Fixture CLI suites invoke the compiled application and inspect its resulting files or provider state.
The teaching workflow also invokes the shipped cheatsheet runtime.
Do not replace these paths with calls to internal setters.

## Evidence

Keep `$aos_proof` outside the repository and every academic mount.
Record each command, exit code and its result file in private run notes.
Require `outcome: passed` and passed child checks. Exit zero alone is insufficient.
Result logs include output digests and bounded private diagnostics. Preserve additional raw output when diagnosing a failure.
Pair mutation claims with the mapped journey's assertions over resulting files, journals or provider state.
For full or formal runs, read the runner-reported nested evidence at its original path: actual model logs, source bindings, compiled schedules, deliberate failures and restored passes.
The outer result is not the retained formal proof.
Preview claims require assertions that the target files and external state stayed unchanged.

Catalogued actions and mapped tests are discovery evidence. Executed fixture journeys prove their assertions only.
Google fixtures replace providers at the production adapter boundary. They do not prove the real account or service.
The feature files name narrower coverage and unreachable prerequisites.
Live writes require separately scoped authority and [the Drive safety procedure](../../../docs/agents/safe-drive-testing.md).
Record attempted routes and missing prerequisites as `verified-unreachable`, never as passed behavior.
Mathematical and rendered-page review remain separate from compilation and structural checks.

## Cleanup

Close every owned listener and child process after its drive. The process observer kills its own process group on timeout.
After interruption, reconcile only roots and PIDs proven to belong to this run. Preserve uncertain residue and report the unresolved ownership.

Keep `$aos_proof/fixtures` at its original path as raw evidence. Full verification stores detailed formal proof there; teaching and repair fixtures also contain evidence referenced by results.
Retain useful failed-iteration artifacts with their observed outcome. Leave fixture links, FIFO metadata and protections intact; inspect ordinary files without following outward links or opening FIFOs.

```sh
test -d "$aos_proof/fixtures"
test -s "$aos_proof/index.json"
```

Before handoff, read each driven feature's retained artifacts. After full/formal, re-read nested results, logs and source bindings at their original paths.
Record the exact evidence paths and owned-process teardown. Later export or storage cleanup needs its own verified retention and exact-owned removal.
Close the verification shell to discard its temporary-directory environment.
Use `pstack:maintain-verification-skill` when behavior or command selection changes.
