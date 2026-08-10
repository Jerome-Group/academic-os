# academic-os

The system one student runs a degree on: how module folders are laid out and named, how the work
in them is tracked, and what the semester's calendar and the personal site are fed from. It is
public because the system is worth copying and costs nothing to share — but it holds only the
system. The coursework it organises lives elsewhere and never enters this repository
([`docs/adr/0002`](docs/adr/0002-the-contract-lives-here-and-the-coursework-does-not.md)).

A [Jerome-Group](https://github.com/Jerome-Group) repository. See [`MAP.md`](MAP.md) to find your
way around and [`AGENTS.md`](AGENTS.md) for how work is done here.

## What is here now

[`docs/module-folder-contract.md`](docs/module-folder-contract.md) — the folder and naming
contract every module folder follows: the universal structure, the parts that appear only when the
module has them, the naming rules, and where LaTeX builds go. It is the interface the
[`ntulearn`](https://github.com/Jerome-Group/ntulearn) importer writes into.

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

You are welcome to read it and to take the ideas. Note that the seeded `LICENSE` is
all-rights-reserved — the repository is published rather than licensed, and if you want a grant,
open an issue and ask; it is a decision that has not been made rather than one that went against
you.
