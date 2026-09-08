# Map

The system one student runs a degree on — and never the coursework it organises.

Start here: `README.md`, then `AGENTS.md`.

| Area | What lives there | Entry point |
|------|------------------|-------------|
| Module folder contract | How every Module folder is laid out and named. Normative — a folder that disagrees with it is wrong | `docs/module-folder-contract.md` |
| Research-project folder contract | The meeting-centred interface for project controls, sources, Learning, Exercises, optional Research promotion and profile-derived Deliverables | `docs/research-project-folder-contract.md`, `docs/adr/0024-…`, `docs/adr/0028-…` |
| Seed-source templates | Canonical bodies of pinned Module and Research-project files — what seeding writes and audit diffs back | `seed-templates/`, `src/contract/pinned-documents.ts`, `src/contract/research-project-structure.ts` |
| Teaching workspace | The `70 Learning` interior the contract requires and seeding creates whole — four activity areas with their records, the LaTeX template set, and the Source map that keys it all by Lecture-unit | `src/contract/learning-workspace.ts`, `seed-templates/70 Learning/`, `src/conformance/audit-learning-workspace.ts` |
| Module CLI | Previewed journalled/resumable seed and approved ID-bound repair, mounted or Drive API inventory, cohort/migration audit, private observations, pure conformance, and reports | `src/cli.ts`, `docs/operator-guide.md`, `docs/v1-acceptance.md` |
| Import status | Read-only active-cohort importer health and the portable NTULearn receipt interface | `src/imports/`, `src/commands/imports-status-command.ts`, `docs/import-status-contract.md` |
| Learning materials | Source Map unit-order availability, missing references and declared tutorial gaps; no completion inference | `src/learning-materials/`, `src/commands/learning-materials-command.ts` |
| Research-project operations | Separate configured identity, profile-derived seed/audit, dated meeting validation, durable private observation history, mounted safety, project task-list targeting and provisional Calendar planning markers | `src/config/resolve-configured-research-project.ts`, `src/seed/create-research-project-seed-plan.ts`, `src/conformance/research-project-contract.ts`, `src/conformance/research-project-controls/meetings.ts`, `src/observation/`, `src/tasks/`, `src/calendar/calendar-proposal-input.ts`, `docs/operator-guide.md` |
| Pinned refresh | Previewed, original-backed replacement of active-cohort Module controls or one exact Research project's shared controls | `src/pinned/`, `src/commands/pinned-refresh-command.ts` |
| Curation register identity | The previewed cohort pass that brings a register's pre-v4 lines onto unnumbered-path plus sha-256 identity by superseding them, and reports the items only a decision or an arrival walk can settle | `src/curation/`, `src/commands/curation-migrate-command.ts`, `docs/adr/0019-…` |
| Curation register split sources | The previewed cohort pass that corrects one source recorded as a curated line per artifact into the single rederived decision MF-CURATION-005 names, deciding per destination so a whole copy among the cuts stays curated | `src/curation/plan-curation-rederivation.ts`, `src/commands/curation-rederive-command.ts`, `docs/adr/0022-…` |
| Calendar CLI | Previewed Owned-calendar setup, resilient pull-only Refresh, local macOS scheduling, conflict-checked Proposals, verified Promotion, and reviewed whole-series Routine migration | `src/calendar/`, `src/commands/calendar-*-command.ts`, `scripts/install-calendar-refresh-launchd.mjs`, `docs/operator-guide.md` |
| Tasks CLI | Previewed target-specific Google Tasks list provisioning, pull-only register refresh for one Module, one Research project or the monitoring cohort, and in-session operations that push, verify and refresh | `src/tasks/`, `src/commands/tasks-*-command.ts`, `docs/operator-guide.md` |
| Textbook shelf | The shared shelf's index, the one-time sweep/review/rename migration that brings an existing shelf into it, and the deterministic daily catch-up that appends every cleanly named new book and parks the rest | `src/textbooks/`, `src/commands/textbooks-catch-up-command.ts`, `src/commands/textbooks-sweep-command.ts`, `src/commands/textbooks-migrate-command.ts`, `docs/operator-guide.md` |
| Operations server | The MCP surface the mini serves on the Tailnet — the served task tools, the Streamable-HTTP entry point bound to the tailnet address, and its resident LaunchAgent | `src/operations/`, `scripts/install-operations-server-launchd.mjs`, `docs/machine-setup.md` |
| Scheduling | The one LaunchAgent installer every scheduled job goes through — a job description in, a timezone-pinned plist and an atomic bootout-first install out | `src/launchd/` |
| Morning routine | The 06:00 pass on the mini — import/shelf/task prelude, nine-domain Module maintenance with private work orders and pre/post audits, the dated report, and the day's single issue | `src/routine/`, `scripts/install-morning-routine-launchd.mjs`, `docs/operator-guide.md` |
| Tests | Public-seam tests using synthetic temporary Module and Research-project trees, plus checks over the documents this repository ships | `test/` |
| The boundary | Why the folders it describes are not in this repository, and what keeps them out | `docs/adr/0002-…`, `.gitignore` |
| Issue tracker | The semester's work and this repository's own — GitHub Issues, not a file | the issue tracker |
| Working here | Agent + contributor conventions, commit/attribution rules | `AGENTS.md` (= `CLAUDE.md`) |
| Contributing | How work flows here — issue first, then a pull request | `CONTRIBUTING.md` |
| Code standards | How code is written and reviewed | `CODING_STANDARDS.md` |
| Domain language | The glossary — this repository's ubiquitous language | `CONTEXT.md` |
| Decisions | Architecture decision records | `docs/adr/` |
| Agent skills | The routines an agent follows here, one file per skill, reached by a pointer in `AGENTS.md` | `docs/agents/` |
| Installed skills | User-invoked harness routes installed at user scope: `/learn` reaches one Module Teaching procedure; `/cheatsheet` reaches one Module Cheatsheet procedure; `/research-project` reaches one Research project's live router | `skills/`, `docs/adr/0017-…`, `docs/adr/0025-…`, `docs/adr/0029-…`, `docs/machine-setup.md` |
| Cheatsheet workflow | Source manifests, coverage, measured fitting, isolated release verification and dependency-complete review packages | `src/cheatsheet/`, `seed-templates/docs/40 Cheatsheet Procedure.template.md`, `docs/adr/0029-…` |
| Research | Primary-source evidence that informs contracts, decisions and agent procedures | `docs/research/` |
| Coordinated improvements | Prioritized Module-management features shared with NTULearn, their dependencies and acceptance boundaries | `docs/research/coordinated-module-management.md` |
| Automation | The workflows that run on a pull request or on a new issue, and dependency updates | `.github/` |
| Quality gates | Cross-file rule coverage, publication checks, and the seeded LaTeX set's compile check — all invoked by package scripts and CI | `scripts/check-contract-rule-coverage.mjs`, `src/privacy/`, `scripts/compile-seed-templates.mjs` |

The data `homepage` reads is named in `README.md` as part of what this repository is for. It has no
entry here because it has no files yet; it earns a row in the pull request that brings it. The
calendar's language and authority boundary are recorded in `CONTEXT.md` and `docs/adr/0006-…`;
setup, pull-only Refresh, private create Proposals and verified Promotion are implemented Calendar
paths.

Update this file in the same pull request whenever a top-level area is added, moved, or removed.
