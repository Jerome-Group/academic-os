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
node dist/src/cli.js capabilities index --json --log "$aos_proof/index.json"
```

Ready means the build succeeds and the index contains actions, profiles and workflows.
These are short-lived CLI processes. The temporary-directory environment contains fixture state inside this run's owned directory.
Do not run builds or drives concurrently in the same checkout. Use separate worktrees for other agents.
There is no server to stop after a normal CLI run.

## Doctor

Before each feature drive, capture a fresh `capabilities health` observation.

```sh
node dist/src/cli.js capabilities health --json --log "$aos_proof/health.json"
```

Require the `node` and `npm` entries to have outcome `passed`.
Choose a new log filename for every observation. Logs refuse replacement.
Teaching release verification and the full profile also require the installed TeX and Poppler tools.
Require passed health for `latexmk`, `pdfinfo`, `pdffonts`, `pdftotext`, `pdftoppm` and `pdftohtml` before claiming release verification.
Missing tools are prerequisites to resolve or report, not successful verification.
Health does not validate credentials, live providers, launchd, maintenance recovery or document quality.
After a failure, doctor again and reset the disposable fixture before retrying.

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
Preview claims require assertions that the target files and external state stayed unchanged.

Catalogued actions and mapped tests are discovery evidence. Executed fixture journeys prove their assertions only.
Google fixtures replace providers at the production adapter boundary. They do not prove the real account or service.
The feature files name narrower coverage and unreachable prerequisites.
Live writes require separately scoped authority and [the Drive safety procedure](../../../docs/agents/safe-drive-testing.md).
Record attempted routes and missing prerequisites as `verified-unreachable`, never as passed behavior.
Mathematical and rendered-page review remain separate from compilation and structural checks.

## Cleanup

Some repair fixtures leave temporary trees. The run's temporary-directory environment contains that residue.
Completed listener fixtures close their owned listeners.
The process observer kills its own process group on timeout. Never kill by process name.
After an interrupted run, reconcile only roots and PIDs proven to have been created by that run.
Preserve uncertain residue and report cleanup as blocked rather than removing a prefix-matched directory.
Remove only the fixture directory created exclusively by Launch. Do not remove `$aos_proof`.
Repair protection fixtures can leave read-only directories and macOS user-immutable flags.
Clear those protections only inside this run's owned fixture directory, without following symlinks.

```sh
if [ "$(uname -s)" = Darwin ]; then
  /usr/bin/chflags -R -P nouchg "$aos_proof/fixtures"
fi
find -P "$aos_proof/fixtures" -type d -exec chmod u+rwx {} +
rm -r -- "$aos_proof/fixtures"
test ! -e "$aos_proof/fixtures"
test -s "$aos_proof/index.json"
```

Confirm the driven feature's evidence files still exist after cleanup.
Close the verification shell to discard its temporary-directory environment.
Use `pstack:maintain-verification-skill` when behavior or command selection changes.
