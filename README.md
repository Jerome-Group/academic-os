# academic-os

The system one student runs a degree on: how module folders are laid out and named, how the work
in them is tracked, and what the semester's calendar and the personal site are fed from. It is
public because the system is worth copying and costs nothing to share — but it holds only the
system. The coursework it organises lives elsewhere and never enters this repository
([`docs/adr/0002`](docs/adr/0002-the-contract-lives-here-and-the-coursework-does-not.md)).

A [Jerome-Group](https://github.com/Jerome-Group) repository. See [`MAP.md`](MAP.md) to find your
way around and [`AGENTS.md`](AGENTS.md) for how work is done here.

## Status

🌱 Early. A CLI previews and explicitly publishes vanilla module seeds, then audits configured
modules' universal structure and controls with append-only private observations. Semester cohorts
remain future work. Y1S1 and Y1S2 are audited historical inputs awaiting explicitly approved
migration;
[`ntulearn`](https://github.com/Jerome-Group/ntulearn) already writes current module material into
contract-declared importer roots.

## What is here now

[`docs/module-folder-contract.md`](docs/module-folder-contract.md) — the folder and naming
contract every module folder follows: the universal structure, the parts that appear only when the
module has them, the naming rules, and where LaTeX builds go. It is the interface the
[`ntulearn`](https://github.com/Jerome-Group/ntulearn) importer writes into.

## Audit one module

Copy `academic-os.config.example.json` to the gitignored `academic-os.config.json`, replace its
placeholder roots, and select one semester and uppercase module code. Then:

```sh
npm ci
npm run build
node dist/src/cli.js audit --config academic-os.config.json
```

Add `--json` for the versioned machine-readable report. Audit never changes the module. Each run
atomically appends a complete observation beneath the configured private `stateRoot`, then reports
new, unchanged, resolved, incompatible, or contract-version-changed history explicitly. Keep that
root outside the Drive mount and this repository; configuration rejects either unsafe location.

## Seed one vanilla module

Prepare an approved Module Profile and Module Definition, then preview every proposed creation:

```sh
node dist/src/cli.js seed --config academic-os.config.json \
  --profile /path/to/approved-profile.md \
  --definition /path/to/approved-definition.yaml
```

Add `--apply` only after reviewing the preview. The command builds a unique staging tree, audits
it, and publishes only a conformant module. On macOS, publication requires the system Ruby runtime
to invoke the filesystem's atomic no-clobber rename. Unsupported volumes fail closed; existing
content is never overwritten or removed.

## What it is for

The contract is the first piece rather than the whole of it. The repository is meant to run the
academic side end to end, and the pieces it is shaped for are:

| Piece | What it is |
|-------|------------|
| Module folder contract | The layout and naming every module folder follows — **here now** |
| Teaching workspace | The `70 Learning` half of the contract: teaching a subject as a way of learning it |
| Tasks | The semester's work, tracked as issues on this repository |
| Calendar | Deadlines, assessments and the teaching timetable, kept somewhere both a person and an agent can read |
| Site data | What [`homepage`](https://github.com/Jerome-Group/homepage) reads to publish the parts of this that are meant to be seen |

Undergraduate now, and shaped so postgraduate work lands in the same place rather than in a second
repository.

## If you are here to copy it

Please do. It is [MIT licensed](LICENSE) — take the contract, rename the folders, keep the parts
that work for your degree and drop the rest. No attribution required and none expected.

The licence covers what is in this repository and nothing else. The coursework a module folder
holds is not here and is not the Owner's to grant — see
[`docs/adr/0003`](docs/adr/0003-the-system-is-mit-licensed.md) for where that line falls.
