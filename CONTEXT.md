# academic-os — context

Running a degree: the modules taken in a semester, the work each one demands, and the folders and
schedules that keep both findable.

## Language

The ubiquitous language of this repository: the words the code, the issues and the commits all
use for the same thing. An entry earns its place when two people — or a person and an agent —
could reasonably mean different things by the same word.

Each entry is the term, what it means **here**, and the near-synonyms to avoid so the wrong one
does not creep back in.

**Module**:
One taught unit of the degree, identified by its module code (`MH2100`). The unit of enrolment
and the unit of organisation — everything else here is scoped to one.
_Avoid_: course, class, subject. *Course* is NTULearn's word for the same thing and appears when
quoting it; *class* is a timetabled session.

**Module folder**:
The directory holding one module's material, laid out to `docs/module-folder-contract.md` and
named for the module code alone. It lives inside the Drive mount, never in this repository.
_Avoid_: module repo — a module folder is not a git repository, and the contract's own deferred
work is what would change that.

**Drive mount**:
The folder on the RAID0 that is synchronised with Google Drive. It is one local view of Drive,
not a second copy to reconcile with the cloud.
_Avoid_: RAID0 copy, local replica

**The contract**:
`docs/module-folder-contract.md`, normative. A module folder that disagrees with it is wrong, and
a rule that is not in it is not a rule.
_Avoid_: the template, the convention. Both suggest a starting point that may be departed from,
which is the opposite of what it is.

**Seed**:
Creating a module folder from the contract, at the start of a semester, after researching what
that module actually has. Additive and one-way: seeding never removes or renames anything.
_Avoid_: scaffold, generate, init

**Conformance**:
The state in which a module folder satisfies every universal and applicable context-derived rule
in the contract.
_Avoid_: exact match, synchronisation

**Deviation**:
A current, observable disagreement between a module folder and an applicable contract rule.
_Avoid_: drift — drift means a change between observations, not merely a present mismatch

**Drift**:
A change in a module folder's conformance between two observations.
_Avoid_: deviation, mismatch

**Repair**:
An approved change to an existing module folder that resolves a deviation without changing the
contract. Unlike a seed, a repair may rename, move, or remove structure.
_Avoid_: seed, migration

**Repair plan**:
The private, versioned and explicitly approved description of one module repair. It binds a
complete Drive-ID inventory, decisions, preconditions, ordered operations, curation events and a
digest; changing any of them invalidates approval.
_Avoid_: shell script, path list

**Recovery snapshot**:
The verified pre-repair evidence needed to restore a module: an ID-mapped Drive copy plus a
SHA-256 byte snapshot on separate storage. Read-only and user-immutable is not regulatory WORM.
_Avoid_: audit observation, Drive Trash

**Contract version**:
The increasing identifier for a distinct set of normative folder requirements. It identifies
which contract a module folder was prepared to follow.
_Avoid_: repository version, commit

**Audit observation**:
A complete record of a module folder's paths, available metadata and conformance results at one
audit time. Comparing audit observations reveals drift without recording file contents.
_Avoid_: backup, snapshot

**Universal structure**:
The directories every module folder has, whatever the module is. Distinguished from the
**context-derived structure**, which appears only when the module has the thing it holds — labs,
projects, quizzes.
_Avoid_: base, default

**Assessment category**:
One of the canonical graded-work directories — `10 Quizzes`, `20 Tests`, `30 Midterms`,
`40 Finals`, `50 Assignments`. Contents are flat; what distinguishes two files is in their names.
_Avoid_: assessment type, exam folder

**Academic contents**:
The material a module folder holds — lecture material, tutorials, notes, submissions, graded work.
Some of it is NTU's and some is a personal record; none of it is committable here
(`docs/adr/0002`).
_Avoid_: files, data. Both are too broad to carry the rule.

**NTULearn mirror**:
The importer-owned copy of NTULearn material inside a module folder's declared importer roots. It
tracks the source and is never reorganised or renamed by curation.
_Avoid_: curated materials, source folder

**Importer root**:
A Definition-declared, automation-owned module directory such as `NTULearn` or
`NTULearn_Tutorial`. Its descendants preserve importer names and sit outside curation rules.
_Avoid_: curated folder, learning materials

**Curation**:
Classifying an item from the NTULearn mirror, copying it into its canonical home, and giving the
copy its curated name. Curation preserves the source item and asks for a decision when placement
is ambiguous.
_Avoid_: move, sync, import

**Curation decision**:
The recorded classification of one NTULearn item as curated, source-only, or requiring a human
decision. A curated decision also identifies the canonical destination and its provenance.
_Avoid_: guess, placement note

**Module profile**:
The human-facing description of one module, kept at `00 Module Admin/00 Module Profile.md` inside
its module folder. It does not define what the auditor enforces.
_Avoid_: module definition, manifest

**Module definition**:
The machine-readable declaration of one module's identity, contract version, and applicable
context-derived structure, kept at `00 Module Admin/10 Module Definition.yaml`.
_Avoid_: module profile, manifest

**Curation register**:
The append-only history of decisions that connect importer items to curated copies, kept at
`00 Module Admin/20 Curation Register.jsonl`.
_Avoid_: NTULearn state, file inventory

**Monitoring cohort**:
The modules in the active semester, which are checked continuously. Past and future modules sit
outside the cohort and change only after a user request or an agent proposal the user accepts.
_Avoid_: all modules, managed modules

**Teaching workspace**:
The `70 Learning` half of the contract: teaching a subject as the way of learning it. Its internal
contract is deferred, and the directory is reserved rather than filled.
_Avoid_: notes. Personal notes are `10 Learning Materials/30 Personal Notes`, which is a different
thing done for a different reason.

Two terms are Organisation-wide and mean the same thing in every repository:

**Organisation**:
The `Jerome-Group` GitHub org — the top-level account that owns the repositories.
_Avoid_: team, group

**Baseline**:
The configuration every repository in the Organisation inherits — branch protection, the
security defaults, and the per-repository settings. It is applied from the management hub, not
from here.
_Avoid_: template, policy, default
