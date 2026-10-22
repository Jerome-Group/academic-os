# Module and Research-project lifecycle

The CLI audits configured folders, previews changes and publishes approved controls through journalled, contained operations.

## Sub-features

- Module and Research-project seeding preview before publication.
- Interrupted seed publication requires explicit `--apply --resume` against the claimed destination.
- Audit and cohort audit report contract violations and retain observations.
- Pinned refresh backs up originals and replaces only owned controls.
- Repair previews an approved plan and enforces identity and recovery requirements.

## How to get to it (user POV)

Use the index entries for `seed`, `audit`, `repair` and `pinned refresh`.
Audit an academic configuration without an explicit target to select its cohort.
Seed and audit support `--research-project`.
Pinned refresh also supports `--research-project` and requires academic/cohort configuration.
Read each action's current usage before selecting a target or using `--apply`.

## Driving it with the compiled CLI

Preconditions: the parent skill's build and fresh doctor succeeded. All fixture mounts are disposable operating-system temporary trees.

```sh
node dist/src/cli.js capabilities verify --workflow recovery --json --log "$aos_proof/recovery.json"
```

Require a passed outcome. The existing CLI journeys check preview leaves the destination absent, apply publishes a conformant Module and audit reads it back.
Research-project journeys check profile-derived folders and supplied initial files.
The Module seed CLI journey interrupts publication and proves explicit resume completes it.
Pinned-refresh journeys compare backups and resulting bytes and reject changed preconditions.
Domain repair journeys check ID-bound recovery and interruption handling alongside the CLI's preview and human/JSON parity.

## Gotchas

Repair CLI coverage currently reaches preview. Domain executor coverage does not prove a real Drive repair.
The selective recovery workflow covers successful seed resume. Competing, missing and replaced root-claim regressions live in mounted suites covered by the full profile.
Live API recovery needs configured credentials, exact IDs, complete inventory and verified independent recoveries.
Repair preview also resolves an existing absolute snapshot root outside Drive, private state and the repository.
Live byte recovery requires separate storage.
Use the Drive safety procedure before any real academic mutation.
Passing seeding fixtures does not authorize seeding or refreshing the Owner's folders.
