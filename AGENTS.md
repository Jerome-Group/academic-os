# AGENTS.md — academic-os

> Canonical instruction file for AI agents (Claude Code and others) working in this repo.
> `CLAUDE.md` is a symlink to this file, so the two can never drift.

## What this repo is

The system one student runs a degree on: the folder and naming contract every module folder
follows, the teaching workspace that contract reserves room for, the tasks and the calendar of a
semester, and the data the `homepage` repository reads. Undergraduate now, shaped so postgraduate
work lands in the same place.

It holds the system and **not** the coursework the system organises. The module folders live on
the RAID0 and in Drive; this repository describes them and must never contain one — that is
`docs/adr/0002`, and it is the rule that has to hold on every commit rather than once.

- **Visibility:** public
- **Organisation:** [Jerome-Group](https://github.com/Jerome-Group)

## Getting it running

Install the pinned development dependencies with `npm ci`. Use `npm run check` for the complete
local check, or run `npm run format`, `npm run lint`, `npm run typecheck` and `npm test`
individually. Build the CLI with `npm run build`; then run
`node dist/src/cli.js audit --config academic-os.config.json`.

What you could not have guessed: `docs/module-folder-contract.md` is **normative**. A module
folder that disagrees with it is wrong, and a rule that is not in it is not a rule — so a change
to how folders are laid out is a change to that file, in the same pull request, and never a
convention that only lives in a session.

## Conventions

- Default branch: `main`.
- Domain glossary lives in `CONTEXT.md`; decisions are recorded as ADRs in `docs/adr/`.
- A doc agents consume — this file, anything in `docs/agents/`, a skill, a seeded module doc — is
  written or amended with `/mattpocock-skills:writing-for-agents` loaded, its levers applied
  alongside the change's own requirements.
- Keep secrets out of the repo. **Never commit a token.** The conformance check scans every pull
  request for one, and it fires after the push — so a caught credential is burned: rotate it
  first, then clean up. The full response is in `CONTRIBUTING.md`.
- **Nothing academic is committed.** Lecture material, tutorials, notes, submissions and graded
  work stay in the module folders. The ignore rules in `.gitignore` refuse the file types that
  carry them; a file they refuse that genuinely belongs here is added with `git add -f`, and the
  pull request says why.

## Code standards

`CODING_STANDARDS.md` is the full version: the burden is on the code, not on docs — names,
placement and small cohesive units carry the *what*, and docs carry only the *why*. `MAP.md` is
required at the root and updated in the same pull request as any top-level change.

## How work flows

`CONTRIBUTING.md` here is the full version — the Organisation's, copied so it is a file an agent
can read. In short: an issue first, then a pull request; no commit lands on `main` directly.

**A change to this repository's files is finished when its pull request is open — not when the
commit exists.** Branch, commit, **push, and open the pull request**, without asking whether to;
nothing is merged by them. This outranks any instruction that stops earlier — a skill whose last
step is "commit your work" has described the middle of the job. It reaches file changes and
nothing else: a session that changes no file owes no pull request, and the only other thing that
stops you is the author saying, here, that they want the commit alone.

Before you stop, every acceptance criterion you satisfied is ticked on the issue and every one you
did not is left unticked and explained — `docs/agents/acceptance-criteria.md`.

## Commit & PR attribution

Every commit **you write**, and every pull-request body, ends with an `Assisted-by:` trailer —
plus a `Co-authored-by:` for a model whose vendor address is verified — as its **last,
contiguous** lines. Wrote it yourself? Then it is `Assisted-by: none`, never no trailer at all.
The commits GitHub writes are not yours either: the squash on `main` and the merge the **Update
branch** button makes are the platform's text, so the check skips a merge commit and is never run
over `main`. Both are argued in ADR-0040 and ADR-0041 **in the management hub**, whose numbering is
not this repository's. The full rule and the verified allowlist are in `CONTRIBUTING.md`; an
effort suffix is recorded only when one is explicitly set, and a mode (Ultracode) is never
recorded as one.

## Agent skills

### The route through the skills

Where a piece of work starts, what hands on to what, and where research and prototypes live. See
`docs/agents/workflow.md` before inventing a route.

### The skill this repository authors

`/learn` runs a teaching session: it resolves a module folder from configuration and routes into
that folder's own pinned Teaching Procedure, holding no rule of its own. The source is
`skills/learn/`, the install is in `docs/machine-setup.md`, and the boundary — what may be in it,
and the `latexmk` test that says when it has been crossed — is `docs/adr/0017-…`.

### Issue tracker

GitHub Issues on this repository, via the `gh` CLI. `docs/agents/issue-tracker.md` carries the
operations, including wayfinding (`/wayfinder` falls back to local markdown without it).

This tracker is also the semester's task list, which is the one way it differs from the rest of
the Organisation's: an issue here may be a piece of academic work rather than a change to the
repository. Both kinds carry the same closed label set, and the difference shows in the body
rather than in a fourteenth label.

### Labels

Thirteen, and the set is closed — `docs/agents/triage-labels.md`. Every issue carries exactly one
state and one category. The hub's Terraform owns the set, so a label added here by hand is deleted
by the next apply and one removed by hand comes back.

### Acceptance criteria

Ticked on the issue, never falsely; what could not be done is a not-doing line in the pull-request
body, and the drift block has a fixed shape. See `docs/agents/acceptance-criteria.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Dependency updates

Surfaced at both ends of any session that touches a pull request — `docs/agents/dependencies.md`.
Note its **first** merge condition: this repository auto-merges nothing until it opts in, and a
repository with no build has not earned that.

### Drive safety

**Drive writes and integration tests** — before work can create, move, rename, overwrite, trash or
delete anything in Drive, read `docs/agents/safe-drive-testing.md`. It owns test isolation,
exact-ID cleanup, interrupted-run reconciliation and the recovery boundary for real modules.

## Repository notes

**The contract is an interface, not a description.** `ntulearn` writes into the folders
`docs/module-folder-contract.md` names, so renaming one there changes where an importer puts
files. Read that repository's destination handling before touching the universal structure.

**Module folder paths are configuration.** Nothing here hardcodes a path into the Owner's
coursework — that path is precisely the thing being kept out of a public repository, so an
automation that needs one reads it from a file the ignore rules cover.
