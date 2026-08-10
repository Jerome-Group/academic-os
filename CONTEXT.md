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
named for the module code alone. It lives on the RAID0 and in Drive, never in this repository.
_Avoid_: module repo — a module folder is not a git repository, and the contract's own deferred
work is what would change that.

**The contract**:
`docs/module-folder-contract.md`, normative. A module folder that disagrees with it is wrong, and
a rule that is not in it is not a rule.
_Avoid_: the template, the convention. Both suggest a starting point that may be departed from,
which is the opposite of what it is.

**Seed**:
Creating a module folder from the contract, at the start of a semester, after researching what
that module actually has. Additive and one-way: seeding never removes or renames anything.
_Avoid_: scaffold, generate, init

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
