# The contract lives here and the coursework does not

This repository describes module folders and must never contain one.

What it holds is the **system**: the folder and naming contract in
[`docs/module-folder-contract.md`](../module-folder-contract.md), the conventions around it, the
tasks and the calendar that run a semester, and the data the `homepage` repository reads. What the
system operates on — lecture material, tutorials, notes, submitted and graded work — stays where
it already is, in the module folders on the RAID0 and in Drive.

The Organisation's ADR-0049 argues the visibility half of this: `academic-os` is public because
the system is publishable, which is only true while the coursework is somewhere else. This record
is the other half, the one that has to hold on every commit rather than once.

## Why an ignore rule and not care

Care is what everyone says they will use, and it fails in one specific move: `git add -A` from the
repository root after dropping a file in to look at it. The material this repository is about
arrives continuously, in bulk, and mostly from a source that is not the Owner — a lecture PDF is
NTU's, and a graded script is a personal record no one intended to publish. Neither is recallable
once pushed to a public repository.

So `.gitignore` refuses the file types that carry it — `*.pdf`, the Office formats, `/modules/`,
`.scratch/`. The rule is blunt on purpose. It will occasionally refuse a file that would have been
fine, and the cost of that is one `git add -f` and a moment's thought about whether the file is
really the system rather than the coursework. That moment is the whole point; it is cheaper than
the alternative, which is noticing afterwards.

## Why the folders are not brought in later either

The tempting version of this repository holds everything and publishes a subset. It does not work
here, because publication is a property of the repository rather than of a directory: making the
tree public makes its history public, and the history is where the coursework would be.

The other tempting version keeps the module folders in a second, private repository so that
everything is version-controlled. That is a real option and it is deferred rather than rejected —
it costs a second repository, a second Baseline and a synchronisation story, and none of that is
worth paying before something actually needs the folders under version control. Today they are
files on a disk that is backed up, which is what they have always been.

## Consequences

- **The contract can go stale against the folders it describes**, and nothing here will notice.
  A folder that disagrees with `docs/module-folder-contract.md` is wrong by definition, but only a
  person or a future checker comparing the two will find it.
- **Automation that reads or writes module folders takes their location as configuration**, the
  way `ntulearn` already does. Nothing in this repository may hardcode a path into the Owner's
  coursework, because that path is the thing being kept out.
- **A file that belongs here and is refused by the ignore rules is added deliberately**, with
  `git add -f`, and its reason belongs in the pull request that adds it.

## Revisit when

- **Something academic is proposed for tracking.** That is this decision being reopened, not a
  file being added.
- **The module folders need version control for their own sake** — a migration, a rename across a
  semester, anything where losing the intermediate states would hurt. The second-repository option
  above is where that conversation starts.
- **The ignore rules start costing real work**, refusing so many legitimate files that `-f`
  becomes routine. A rule that is routinely bypassed has stopped being a rule.
