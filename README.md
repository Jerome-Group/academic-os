# academic-os

The system one student runs a degree on: how module folders are laid out and named, how the work
in them is tracked, and what the semester's calendar and the personal site are fed from. It is
public because the system is worth copying and costs nothing to share — but it holds only the
system. The coursework it organises lives elsewhere and never enters this repository
([`docs/adr/0002`](docs/adr/0002-the-contract-lives-here-and-the-coursework-does-not.md)).

A [Jerome-Group](https://github.com/Jerome-Group) repository. See [`MAP.md`](MAP.md) to find your
way around and [`AGENTS.md`](AGENTS.md) for how work is done here.

## Status

✅ V1 proved. The CLI previews and explicitly publishes additive module seeds, audits the
configured active semester as a monitoring cohort, and records append-only private observations.
Past and future modules remain explicit targets; historical differences are assessed in read-only
migration mode. The [operator guide](docs/operator-guide.md) and
[acceptance evidence](docs/v1-acceptance.md) cover operation and boundaries. Y1S1 and Y1S2 remain
historical inputs awaiting separately approved repair;
[`ntulearn`](https://github.com/Jerome-Group/ntulearn) already writes current module material into
contract-declared importer roots.

The separately gated `repair` command now executes only an approved, Drive-ID-bound historical
migration plan after fresh inventory and dual recovery verify. It previews by default and has no
permanent-delete or Trash operation.

## What is here now

[`docs/module-folder-contract.md`](docs/module-folder-contract.md) — the folder and naming
contract every module folder follows: the universal structure, the parts that appear only when the
module has them, the naming rules, and where LaTeX builds go. It is the interface the
[`ntulearn`](https://github.com/Jerome-Group/ntulearn) importer writes into.

## Audit the active semester

Copy `academic-os.config.example.json` to the gitignored `academic-os.config.json`, replace its
placeholder roots, and declare each semester's status, relative root, and module codes. Exactly one
semester is active. Then:

```sh
npm ci
npm run build
node dist/src/cli.js audit --config academic-os.config.json
```

Add `--json` for the versioned machine-readable report. Audit never changes the module. Each run
atomically appends a complete observation beneath the configured private `stateRoot`, then reports
new, unchanged, resolved, incompatible, or contract-version-changed history explicitly. Keep that
root outside the Drive mount and this repository; configuration rejects either unsafe location.

Name both fields to audit one configured module outside routine monitoring:

```sh
node dist/src/cli.js audit --config academic-os.config.json \
  --semester Y2S2 --module MH2200
```

Add `--migration` only for a configured past-semester target. It evaluates that historical module
with historical-migration interpretation. An explicitly requested past module may also be audited
normally as read-only acceptance evidence; neither mode changes it or adds it to the active cohort.

For one explicit module, add its folder ID under `driveApi.moduleFolderIds` and pass
`--inventory drive-api`. This optional route uses Application Default Credentials with only
`drive.metadata.readonly`; it enriches the same audit with provider IDs and available metadata.
Without that flag, credentials and the Drive API are never consulted. Keep credentials, raw API
responses, observations, and reports outside tracked content.

## Seed one vanilla module

Set `seedTarget` in the same local configuration, prepare an approved Module Profile and Module
Definition, then preview every proposed creation:

```sh
node dist/src/cli.js seed --config academic-os.config.json \
  --profile /path/to/approved-profile.md \
  --definition /path/to/approved-definition.yaml
```

Add `--apply` only after reviewing the preview. For a new module, the command builds and audits a
unique staging tree, then atomically renames the complete tree to its published directory name. For an
existing partial module it publishes only missing operations. Every apply is recorded in an
append-only journal beneath the private `stateRoot`; existing matching operations are skipped and
content is never overwritten, moved, renamed, or removed.

After an interrupted apply, rerun the same command first without `--resume`. It recomputes target
preconditions and reports completed and remaining operations without changing Drive. If the report
is `safely-resumable`, rerun with both `--apply --resume`. Changed controls, contract version,
target identity, conflicts, or ambiguous journal state block continuation with evidence. Staging
artifacts are removed after completion or a safely handled failure; the private journal remains.

## What it is for

The contract is the first piece rather than the whole of it. The repository is meant to run the
academic side end to end, and the pieces it is shaped for are:

| Piece | What it is |
|-------|------------|
| Module folder contract | The layout and naming every module folder follows — **here now** |
| Teaching workspace | The `70 Learning` half of the contract: teaching a subject as a way of learning it |
| Tasks | The semester's work, tracked as issues on this repository |
| Calendar | Classes, assessments, meetings, appointments and recurring life events in Google Calendar; tasks and self-directed work stay elsewhere |
| Site data | What [`homepage`](https://github.com/Jerome-Group/homepage) reads to publish the parts of this that are meant to be seen |

Undergraduate now, and shaped so postgraduate work lands in the same place rather than in a second
repository.

## If you are here to copy it

Please do. It is [MIT licensed](LICENSE) — take the contract, rename the folders, keep the parts
that work for your degree and drop the rest. No attribution required and none expected.

The licence covers what is in this repository and nothing else. The coursework a module folder
holds is not here and is not the Owner's to grant — see
[`docs/adr/0003`](docs/adr/0003-the-system-is-mit-licensed.md) for where that line falls.
