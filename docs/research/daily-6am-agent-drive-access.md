# Where a daily 06:00 curation run with Drive access can execute

## Conclusion

Three runtimes can host the daily 06:00 NTULearn curation run, and they divide on two axes:
whether the run can see the local Drive mount, and whether an agent is in the loop for the
judgment that curation requires. None is chosen here — that is the grilling ticket
([#77](https://github.com/Jerome-Group/academic-os/issues/77)).

|                             | Cloud routine                                                    | Local headless agent (`claude -p`)                                      | Plain launchd + built CLI                                            |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Runs on                     | Anthropic-managed cloud                                          | The Owner's Mac                                                         | The Owner's Mac                                                      |
| Local Drive mount           | **No** — fresh clone of a GitHub repo, no local files            | Yes, as the logged-in user                                              | Yes, as the logged-in user                                           |
| Drive API fallback          | Only route to Drive at all (connector or env-var credential)     | Available (private credential file)                                     | Available (private credential file)                                  |
| Judgment (MF-CURATION-002)  | Agent in the loop                                                | Agent in the loop                                                       | **No** — deterministic only; ambiguity must be parked, not resolved  |
| Anthropic credential needed | claude.ai subscription login (routines reject API accounts)      | Subscription login via keychain, or `ANTHROPIC_API_KEY` with `--bare`   | None                                                                 |
| Mac asleep at 06:00         | Runs anyway                                                      | Missed fire coalesced into one run on wake                              | Missed fire coalesced into one run on wake                           |
| Mac off / logged out        | Runs anyway                                                      | Skipped, no catch-up                                                    | Skipped, no catch-up                                                 |
| Failure surface             | Green run status does not mean task success; read the transcript | Exit code + whatever reporting is built                                 | Exists today: silent success, one local notification on failure      |
| Second machine needs        | Nothing                                                          | Checkout, Node, Claude Code + auth, Drive access, private config, plist | Checkout, Node, Drive access, private config, plist                  |
| Repo precedent              | None                                                             | None                                                                    | `scripts/install-calendar-refresh-launchd.mjs` (daily 05:00 Refresh) |

## The constraint that shapes the comparison

Curation is not fully deterministic. MF-CURATION-002 in `docs/module-folder-contract.md` is a
**judgment** rule: every importer-source item becomes curated, source-only or requires-decision,
and "Ambiguous placement is shown with evidence and left uncopied until resolved." A canonical
destination and an MF-NAMING-002 name for an ambiguous item is a decision, so a runtime with no
agent (or human) in the loop can at most inventory, copy the unambiguous, and park the rest.
The comparison therefore separates "deterministic CLI can do it" (sweep, copy, report) from "an
agent must be in the loop" (resolve requires-decision items at 06:00 rather than leave them for
the Owner).

A second standing constraint: the Drive mount is a production surface
(`docs/research/safe-google-drive-testing.md`). Streamed files can be unavailable when Drive for
desktop is not running, so any mount-reading 06:00 run depends on Drive for desktop being signed
in and running in the user session — which is exactly the state a per-user LaunchAgent shares.
The Drive API fallback removes that dependency at the cost of a second credential.

## Option A — Claude Code cloud routine

Routines are saved Claude Code configurations that "execute on Anthropic-managed cloud
infrastructure … so they keep working when your laptop is closed"
([Routines](https://code.claude.com/docs/en/web-scheduled-tasks)). The scheduling comparison
table is explicit that cloud tasks have **no access to local files** — each run starts from a
fresh clone of the selected GitHub repositories
([Run prompts on a schedule](https://code.claude.com/docs/en/scheduled-tasks)). The expected
answer verifies: a cloud-executed routine cannot reach the Drive mount on the Owner's Mac under
any configuration. The mount path is not even representable — the module folders are coursework,
outside every repository a routine could clone (ADR-0002).

So for a routine, the Drive **API is the only route**, via one of:

- the claude.ai Google Drive connector (an MCP connector attached to the routine; connectors
  route through Anthropic's servers and a routine "can use every tool from an included
  connector, including writes, without asking for permission during a run"); or
- Drive API credentials placed in the cloud environment — with the documented caveat that
  environment variables are "visible to anyone who uses the environment", which for a personal
  account is milder but still parks a Google credential in Anthropic's cloud rather than in an
  owner-only file on the Mac.

Characteristics:

- **Access.** GitHub repos (cloned per run), attached connectors, allowlisted network. Runs
  autonomously — no permission prompts at all.
- **Credentials.** A claude.ai subscription login owns the routine (API accounts are not
  supported); Drive access needs the connector grant or an env-var credential as above.
- **Schedule and failure.** Minimum interval one hour; runs "may start a few minutes after the
  scheduled time due to stagger"; a daily per-account run cap applies. A green run status "does
  not mean the task in your prompt succeeded" — failures surface only in the run transcript, so
  a routine needs its own report-back channel (e.g. opening an issue) to be observable.
- **Sleep/off.** Irrelevant; the run happens regardless of the Mac's state. This is the one
  runtime where 06:00 actually means 06:00 every day.
- **Second machine.** Needs nothing — and gains nothing, since no machine's mount is reachable.
- **Judgment.** An agent by construction; MF-CURATION-002 decisions can be attempted in-run.
- **Research preview.** Routines are explicitly in research preview; behaviour and limits may
  change.

## Option B — locally scheduled headless Claude Code

`claude -p` runs Claude Code non-interactively on the machine it is invoked on
([Run Claude Code programmatically](https://code.claude.com/docs/en/headless)): a launchd job (or
cron line) can run `claude -p "<curation prompt>" --allowedTools …` at 06:00. Being a local
process under the logged-in user, it sees the Drive mount exactly as the Owner does, and can fall
back to the Drive API with the same private credential file Option C would use.

Characteristics:

- **Access.** Full local filesystem including `<drive-mount>`; whatever tools the invocation
  allows (`--allowedTools`, `--permission-mode`; `dontAsk` denies anything not explicitly
  allowed, useful for a locked-down unattended run). Exit code 0/non-zero lets the wrapper
  branch on failure, and `--output-format json` gives a parseable result.
- **Credentials.** Two sets. (1) Anthropic: the docs recommend `--bare` for scripted calls, and
  in bare mode "Claude Code never reads OAuth credentials or the system keychain" — so a bare
  scheduled run needs `ANTHROPIC_API_KEY` in the job's environment; without `--bare` it uses the
  stored subscription login, coupling the job to interactive login state and loading
  hooks/MCP/CLAUDE.md from the working directory. (2) Google: the Drive-for-desktop session for
  the mount, or a Drive API credential file at a private owner-only path, following the calendar
  pattern in `docs/operator-guide.md` (scheduled-read credential, minimal scopes, outside git).
- **Sleep/failure.** launchd `StartCalendarInterval` semantics apply: "Unlike cron which skips
  job invocations when the computer is asleep, launchd will start the job the next time the
  computer wakes up. If multiple intervals transpire before the computer is woken, those events
  will be coalesced into one event upon wake from sleep" (`launchd.plist(5)`). Time powered off
  or logged out (a gui-domain LaunchAgent needs the user session) is not made up. Beyond that,
  an agent run fails in agent ways — usage limits, a wrong judgment, a partial run — so it needs
  a reporting convention of its own; none exists yet, unlike Option C's.
- **Second machine.** Repo checkout with built CLI, Node, Claude Code installed and
  authenticated, Drive for desktop signed in (or the credential file copied), the private
  config naming the module folder paths, and the plist installed per-user.
- **Judgment.** Agent in the loop, on the machine that has the files — the only option with
  both.

A managed variant exists: **Desktop scheduled tasks** run locally with file access from the
Desktop app's scheduler instead of launchd
([Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)). They add
per-task saved permissions and one catch-up run on wake ("If it did, Desktop starts exactly one
catch-up run for the most recently missed time"), but "only run while the desktop app is running
and your computer is awake" — the schedule depends on an open GUI app rather than on launchd.

## Option C — plain launchd job running the built CLI (repo precedent)

The repository already schedules a daily local run this way: the Calendar Refresh LaunchAgent
(`scripts/install-calendar-refresh-launchd.mjs`, `src/calendar/calendar-refresh-launchd.ts`,
operator guide "Install the daily local Refresh (macOS)"). Its shape is the precedent a 06:00
curation sweep would copy:

- a per-user plist in `~/Library/LaunchAgents/`, `StartCalendarInterval` at a fixed hour,
  `RunAtLoad` false, stdout/stderr to `/dev/null`, installed atomically and bootstrapped into
  `gui/<uid>`; timezone pinned to Asia/Singapore at install;
- the job runs only the built CLI with a private config — no LLM, no Anthropic credential;
- read paths use a minimal scheduled-read credential; state, credentials, exact IDs and
  scheduler files stay outside git;
- failure is observable without being noisy: a successful run is silent, a failed run retains
  last-good state and raises **one** concise local notification via `osascript`.

Characteristics:

- **Access.** Same as Option B: the mount as the logged-in user, or the Drive API via a private
  credential file.
- **Sleep/failure.** Same launchd coalescing as Option B; the operator guide already documents
  "launchd catches up after sleep/wake" for the 05:00 Refresh. Deterministic code, so failures
  are ordinary exit paths the runner already knows how to notify about.
- **Second machine.** Same as Option B minus everything Anthropic: checkout, Node, Drive
  access, private config, plist.
- **Judgment — the hard limit.** MF-CURATION-002 means a deterministic CLI cannot finish
  curation alone. It can inventory importer roots, copy the unambiguous into canonical
  destinations, and emit a requires-decision report with evidence — but ambiguous items stay
  uncopied until something with judgment resolves them. Option C therefore implies a pairing:
  the 06:00 sweep parks decisions for the Owner (or a later agent session, possibly Option B
  invoked on demand rather than on the clock), rather than resolving them at 06:00.

## What this leaves for #77

The live trade is not "which scheduler" but "where does the judgment sit": A puts the agent
where the files are not; C puts the files where the agent is not; B has both but stacks an
Anthropic credential, agent-shaped failure modes and a missing reporting convention on top of
the launchd base that C gets for free. A hybrid (C's deterministic sweep at 06:00, judgment
deferred to an agent or the Owner) is a fourth shape #77 can weigh.

## Sources

- [Automate work with routines — Claude Code docs](https://code.claude.com/docs/en/web-scheduled-tasks)
- [Run prompts on a schedule — Claude Code docs](https://code.claude.com/docs/en/scheduled-tasks)
- [Schedule recurring tasks in Claude Code Desktop — Claude Code docs](https://code.claude.com/docs/en/desktop-scheduled-tasks)
- [Run Claude Code programmatically (headless `claude -p`) — Claude Code docs](https://code.claude.com/docs/en/headless)
- `launchd.plist(5)` man page, macOS — `StartCalendarInterval` sleep/wake coalescing
- `docs/module-folder-contract.md` — MF-CURATION-002
- `docs/operator-guide.md` — "Install the daily local Refresh (macOS)"; credential handling
- `scripts/install-calendar-refresh-launchd.mjs`, `src/calendar/calendar-refresh-launchd.ts`
- `docs/research/safe-google-drive-testing.md` — the mount as a production surface
