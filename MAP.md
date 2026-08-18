# Map

The system one student runs a degree on — and never the coursework it organises.

Start here: `README.md`, then `AGENTS.md`.

| Area | What lives there | Entry point |
|------|------------------|-------------|
| The contract | How every module folder is laid out and named. Normative — a folder that disagrees with it is wrong | `docs/module-folder-contract.md` |
| Seed-source templates | The canonical bodies of the pinned module files — what seeding will write into a module folder and the auditor will diff it against | `seed-templates/` |
| Module CLI | Previewed journalled/resumable seed and approved ID-bound repair, mounted or Drive API inventory, cohort/migration audit, private observations, pure conformance, and reports | `src/cli.ts`, `docs/operator-guide.md`, `docs/v1-acceptance.md` |
| Calendar CLI | Previewed Owned-calendar setup, resilient pull-only Refresh, local macOS scheduling, conflict-checked Proposals, verified Promotion, and reviewed whole-series Routine migration | `src/calendar/`, `src/commands/calendar-*-command.ts`, `scripts/install-calendar-refresh-launchd.mjs`, `docs/operator-guide.md` |
| Tests | Public-seam tests using synthetic temporary module trees | `test/` |
| The boundary | Why the folders it describes are not in this repository, and what keeps them out | `docs/adr/0002-…`, `.gitignore` |
| Tasks | The semester's work and this repository's own — GitHub Issues, not a file | the issue tracker |
| Working here | Agent + contributor conventions, commit/attribution rules | `AGENTS.md` (= `CLAUDE.md`) |
| Contributing | How work flows here — issue first, then a pull request | `CONTRIBUTING.md` |
| Code standards | How code is written and reviewed | `CODING_STANDARDS.md` |
| Domain language | The glossary — this repository's ubiquitous language | `CONTEXT.md` |
| Decisions | Architecture decision records | `docs/adr/` |
| Agent skills | The routines an agent follows here, one file per skill | `docs/agents/` |
| Research | Primary-source evidence that informs contracts, decisions and agent procedures | `docs/research/` |
| Automation | The workflows that run on a pull request or on a new issue, and dependency updates | `.github/` |
| Quality gates | Cross-file rule coverage and publication checks invoked by package scripts and CI, plus the seeded LaTeX set's compile check, which needs `latexmk` and so runs locally | `scripts/check-contract-rule-coverage.mjs`, `src/privacy/`, `scripts/compile-seed-templates.mjs` |

The teaching workspace and the data `homepage` reads are named in `README.md` as what this
repository is for. They have no entry here because they have no files yet; each earns a row in the
pull request that brings it. The calendar's language and authority boundary are recorded in
`CONTEXT.md` and `docs/adr/0006-…`; setup, pull-only Refresh and private create Proposals are
and verified Promotion are implemented Calendar paths.

Update this file in the same pull request whenever a top-level area is added, moved, or removed.
