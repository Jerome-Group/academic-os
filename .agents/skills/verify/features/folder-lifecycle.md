# Module and Research-project lifecycle

The CLI audits configured folders, previews changes and publishes approved controls through journalled, contained operations.

## Sub-features

- Module and Research-project seeding preview before publication.
- Research manifest v2 supplies an approved complete Meeting and its caller-owned schedule. Manifest v1 keeps its original plan identity and meeting-free behavior.
- Interrupted seed publication requires explicit `--apply --resume` against the claimed destination.
- Seed and repair apply hold one same-host owner for the exact journal before continuation reads and effects; reliable private SQLite locking is required.
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
Research-project journeys check profile-derived folders, meeting-free seeding and complete manifest-v2 Meeting intake.
They compare exact note, schedule and binary payload bytes after publication and replay, then audit the result through the compiled CLI.
Missing or invalid notes, inconsistent schedules, binary schedule controls, pinned replacements, existing-content conflicts and unsupported policies refuse before publication.
Saved-plan cases reject mixed Module and Research identities, including a supported policy attached to the wrong variant, without changing the journal or target.
They verify the entire stored plan against its recorded digest, reject both supported policy transitions and altered saved operation bytes, and preserve every Research target file.
Manifest fixtures reject conflicting and escaped duplicate version keys before policy selection, while both valid intake policies preserve source payload bytes.
Mounted fixtures also exercise staged Meeting interruption and exact-plan resume, including refusal after schedule bytes or policy identity change.
Public URECA and generic audits reject undeclared first-level Deliverable and Resource directories under RP-ROOT-002. Required categories, universal Unclassified, nesting inside permitted homes and direct files at the category roots remain conformant.
The Module seed CLI journey interrupts publication and proves explicit resume completes it.
Pinned-refresh journeys compare backups and resulting bytes and reject changed preconditions.
Recovery selects all mounted, repair, seed and pinned suites, including competing, missing and replaced root claims.
Compiled seed processes exercise interruption, competition, death and explicit resume.
Repair CLI fixtures cover preview/parity, unsafe snapshot roots, malformed planned parents and competing apply/resume refusal before effects.
Successful repair apply/resume and retained-recovery inspection are domain-executor fixtures with fake providers.

## Gotchas

Successful compiled CLI repair mutation and real Drive recovery remain separate from preview, concurrency-refusal and domain-fixture proof.
The [formal skill](../../seed-ownership/SKILL.md) checks bounded seed filesystem and cooperating journal ownership; it does not prove whole repair recovery or arbitrary filesystem race safety.
Live API recovery needs configured credentials, exact IDs, complete inventory and verified independent recoveries.
Repair preview also resolves an existing absolute snapshot root outside Drive, private state and the repository.
Live byte recovery requires separate storage.
Use the Drive safety procedure before any real academic mutation.
Passing seeding fixtures does not authorize seeding or refreshing the Owner's folders.
