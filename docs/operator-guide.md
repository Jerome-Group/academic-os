# Operator guide

The CLI has `seed`, `audit`, `calendar setup`, pull-only `calendar refresh`, private `calendar
propose`, explicitly authorised `calendar promote`, `tasks provision`, pull-only `tasks refresh`,
in-session `tasks create`, `tasks change`, `tasks complete` and `tasks cancel`, additive `textbooks
catch-up`, the unattended `routine morning`, previewed `pinned refresh`, previewed
`curation migrate`, previewed `curation rederive` and separately gated `repair` commands. It does
not orchestrate a week of study or evolve a module's instructions on its own.

## Configure

Copy `academic-os.config.example.json` to the gitignored `academic-os.config.json`. Set the Drive
mount, a private state root outside both Drive and this repository, exactly one active semester,
and explicit semester/module mappings. Add `seedTarget` only for the approved module to seed.
Optional Drive API inventory needs an exact module-folder ID and read-only application-default
credentials; mounted inventory remains the baseline.

Repair additionally needs the exact module folder ID, a dedicated unmonitored Drive recovery-root
ID, and an existing `snapshotRoot` on a physically separate volume. Its full-Drive OAuth scope is
used only when `repair` is invoked; audit retains metadata-read-only authorization.

Calendar commands need a current ISO-8601 `managementHorizon` and two distinct absolute credential
paths. Authorise scheduled-read credentials only for `calendar.calendarlist.readonly` and
`calendar.events.readonly`. Authorise interactive-write credentials separately for
`calendar.calendars` and `calendar.events`; setup uses calendar-creation authority only after
`--apply`, and Promote is the only event-writing path. Keep both files and the configuration
outside git.

On macOS, a convenient private layout is `$HOME/.config/academic-os/`: keep the downloaded Desktop
OAuth client files as `calendar-read-client.json` and `calendar-write-client.json`, and keep the
separately authorised user credential files as `calendar-read.credentials.json` and
`calendar-write.credentials.json`. These are private files, should be owner-only, and must never be
copied into the repository.

Tasks commands need their own pair of distinct absolute credential paths under `tasks`. The two
Tasks scopes are the whole set Google offers: authorise scheduled-read credentials for
`tasks.readonly`, and interactive-write credentials separately for `tasks` — which necessarily
covers every task list on the account, so the write credential is the one to keep furthest from a
scheduled job. Enable the Tasks API once on the same Cloud project as the Calendar OAuth clients
before the first approval. Mint each file with the shared consent helper:

```sh
node scripts/authorize-google-credentials.mjs \
  --surface tasks --role read \
  --client "$HOME/.config/academic-os/tasks-read-client.json" \
  --scopes https://www.googleapis.com/auth/tasks.readonly \
  --output "$HOME/.config/academic-os/tasks-read.credentials.json"
```

```sh
node scripts/authorize-google-credentials.mjs \
  --surface tasks --role write \
  --client "$HOME/.config/academic-os/tasks-write-client.json" \
  --scopes https://www.googleapis.com/auth/tasks \
  --output "$HOME/.config/academic-os/tasks-write.credentials.json"
```

A refresh token carries the scopes it was granted, so widening a credential means running the
helper again rather than editing the config. `tasks provision --apply` is the only path that uses
the write credential.

The Operations server needs no credentials of its own: it runs the same task operations on the
mini under the same pair.

`textbooks catch-up` needs `textbooks.shelfRoot` — the Textbook shelf relative to the Drive mount,
beside the semester roots. It reads the shelf and writes only the shelf's own `00 Index.yaml`, so
it needs no credentials at all.

`routine morning` needs `routine.codexPath` and `routine.ghPath` — absolute paths to the Codex CLI
it runs each Module pass under and to the `gh` CLI it raises the morning's issue through. Both are
paths rather than names because a LaunchAgent runs with a minimal `PATH` and would find neither at
06:00. The Codex CLI ships inside the ChatGPT desktop app, at
`/Applications/ChatGPT.app/Contents/Resources/codex`; `~/.local/bin/codex` may still point at a
standalone `Codex.app` that no longer exists, so name the binary rather than the symlink. It uses the Tasks scheduled-read credential and nothing else of its own; `gh` uses whatever
login `gh auth status` reports on the mini.

This checkout includes `scripts/setup-calendar-local.sh`, which walks through the two sequential
Google approvals, private config update, setup preview, explicit setup apply, initial Refresh and
optional LaunchAgent installation. It stops before any event migration or Promotion.

## Calendar setup

Preview the Owned-calendar topology:

```sh
node dist/src/cli.js calendar setup --config academic-os.config.json
```

The command binds the Google primary calendar as Academic without creating or renaming it. It
reuses exact Commitments and Routine names and reports any missing secondary calendar as
`would create`. Preview does not create calendars or write an incomplete workspace.

After reviewing the preview, create only the missing secondary calendars and persist all three
exact IDs beneath `stateRoot/calendar/`:

```sh
node dist/src/cli.js calendar setup --config academic-os.config.json --apply
```

Rerunning setup is safe: existing calendars are reused and no duplicates are created. The private
workspace also records the Asia/Singapore default timezone and Management horizon. Use `--json`
for the equivalent versioned result. Never commit the workspace, provider responses, credentials,
or the local configuration.

## Calendar refresh

After setup, pull the Live state of all three Owned calendars from the Management horizon forward:

```sh
node dist/src/cli.js calendar refresh --config academic-os.config.json
```

Refresh uses only scheduled-read credentials. It supplies no future cutoff, keeps recurring masters
and dated exceptions compact, and mirrors invitations as read-only context on the calendar where
Google placed them. A clearly misplaced transparent recurring item remains on its actual calendar
and is reported as a non-mutating Placement suggestion.

Repeated runs need no manual token reset. A nonzero result may still have advanced other calendars:
read the named stale calendars and their last successful Refresh in either human or `--json`
output. Do not use stale state for Promotion; rerun Refresh after fixing provider access. The
freshness and deletion-safety boundary is recorded in ADR-0006.

### Install the daily local Refresh (macOS)

Build the current CLI, then install the private per-user LaunchAgent from this checkout:

```sh
npm run build
node scripts/install-calendar-refresh-launchd.mjs \
  --config /private/path/academic-os.config.json
```

The installer requires the Mac timezone to be `Asia/Singapore`. It writes only
`~/Library/LaunchAgents/com.jerome-group.academic-os.calendar-refresh.plist`; launchd runs the
generated command at 05:00 and coalesces a missed sleep-time run on wake. `RunAtLoad` is disabled,
stdout and stderr go to `/dev/null`, and the command invokes only `calendar refresh` with the
configured scheduled-read credential. The interactive-write credential is not used.

Inspect the loaded job and its exact private plist:

```sh
plutil -p "$HOME/Library/LaunchAgents/com.jerome-group.academic-os.calendar-refresh.plist"
launchctl print "gui/$(id -u)/com.jerome-group.academic-os.calendar-refresh"
```

Run the installed job manually:

```sh
launchctl kickstart -k "gui/$(id -u)/com.jerome-group.academic-os.calendar-refresh"
```

For a visible report, run the CLI directly with the same private config. A successful scheduled
Refresh is silent. A nonzero Refresh retains last-good mirrors, marks affected calendars stale,
and causes one concise local notification; repeated calendar failures in that run do not create
additional notifications. State, credentials, exact IDs, and scheduler files stay outside git.

Remove the exact job and plist:

```sh
node scripts/install-calendar-refresh-launchd.mjs --remove
```

## Calendar propose

Refresh first, then prepare one private create Proposal from an input file outside git:

```sh
node dist/src/cli.js calendar propose --config academic-os.config.json \
  --input /private/path/calendar-proposal-input.json
```

The versioned input names a source and one item. Fixed and Routine events use `start` and `end`
objects containing an ISO-8601 `dateTime` with an offset and optional IANA `timeZone`; omitted
timezones default to Asia/Singapore. Timed milestones use `at` and a transparent one-minute
provider representation while consuming no conflict interval; all-day milestones use a
timezone-free `date`.

```json
{
  "schemaVersion": 1,
  "source": { "kind": "instruction", "reference": "private-request-1" },
  "item": {
    "kind": "fixed-event",
    "calendarRole": "Academic",
    "summary": "Topology seminar",
    "start": { "dateTime": "2026-08-20T10:00:00+08:00" },
    "end": { "dateTime": "2026-08-20T11:00:00+08:00" },
    "travelBuffer": { "beforeMinutes": 10, "afterMinutes": 5 }
  }
}
```

`kind` is `fixed-event`, `routine-event`, `timed-milestone` or `all-day-milestone`. Fixed events
target Academic or Commitments; Routine events target Routine. Propose reads current Owned mirror
versions, calendar defaults and bounded availability through read-only credentials. Fixed busy
overlaps block and write no Proposal; Routine overlaps warn. Milestones consume no interval.
Only an explicitly supplied travel buffer expands a conflict check. The ready Proposal replaces
the current pending Proposal beneath `stateRoot/calendar/`; Observed event details are reported
only in the transient preview and are not persisted. Propose never changes Google Calendar. Use
`--json` for the deterministic equivalent preview.

Routine-event inputs may also include an explicit `recurrence` array, such as
`["RRULE:FREQ=WEEKLY;BYDAY=MO"]`; the Proposal preserves the recurrence on the created Routine
series.

### NTU academic timetable

The `academic-timetable` input turns a private timetable manifest into one bulk Academic Proposal.
The manifest stays outside git and contains `classes` plus `exams`; classes use `weekday`,
`startTime`, `endTime` and optional `weeks` (`{ "from": 2, "to": 13 }` or `{ "week": 12 }`).
An omitted `weeks` field means Wk1-Wk13. The built-in NTU AY2026-27 Semester 1 date map applies
official public-holiday and no-class exceptions, and emits Google recurring-series rules for
bounded multi-week classes. Exams are one-off timed events. Both classes and exams are private,
busy Academic events.

Example shape (use a private absolute input path):

```json
{
  "schemaVersion": 1,
  "source": { "kind": "ntu-timetable", "reference": "private-manifest-1" },
  "item": {
    "operation": "academic-timetable",
    "calendarRole": "Academic",
    "term": "AY2026-27-S1",
    "classes": [
      {
        "key": "mh0000-lecture",
        "summary": "MH0000 lecture",
        "weekday": "MO",
        "startTime": "09:30",
        "endTime": "11:20",
        "location": "Example room"
      }
    ],
    "exams": [
      {
        "key": "mh0000-exam",
        "summary": "MH0000 exam",
        "date": "2026-11-24",
        "startTime": "13:00",
        "endTime": "15:00"
      }
    ]
  }
}
```

Propose checks every expanded occurrence against current Owned and selected Observed availability,
then writes one private bulk Proposal. Review its exact event count, recurrence exceptions,
locations, exam dates, conflicts and warnings before promoting. A room list from a timetable is
kept on one event; it does not create overlapping copies.

### Routine-series migration

The initial Routine migration uses the same Proposal path. Supply reviewed provider identities from
the current Academic mirror; labels are only human context and never identity:

```json
{
  "schemaVersion": 1,
  "source": { "kind": "routine-migration", "reference": "reviewed-2026-08" },
  "item": {
    "operation": "routine-migration",
    "reviewedSeries": [
      {
        "providerIdentity": {
          "calendarRole": "Academic",
          "calendarId": "private-academic-calendar-id",
          "eventId": "private-sleep-series-id"
        },
        "label": "sleep"
      },
      {
        "providerIdentity": {
          "calendarRole": "Academic",
          "calendarId": "private-academic-calendar-id",
          "eventId": "private-exercise-series-id"
        },
        "label": "exercise"
      }
    ]
  }
}
```

The preview is one Proposal containing exact whole-series moves, already-completed moves and
identities requiring a human decision. It never selects by title alone. Promote that reviewed
Proposal explicitly; the move preserves the recurring master and exceptions, changes only an
opaque master to Routine's default transparency, and leaves reminders and other event fields
alone. Reread verification and post-Promotion Refresh must prove every approved series moved.
Past occurrences may appear under Routine after the move but remain outside forward Routine
management. Repeating the migration preview reports completed series and proposes no duplicate
moves.

## Calendar promote

After reviewing one ready Proposal, authorise that exact ID:

```sh
node dist/src/cli.js calendar promote proposal-0123456789abcdef01234567 \
  --config academic-os.config.json
```

Promote Refreshes first and blocks without writing when required state is stale, a blocking
conflict has appeared, or the Proposal's provider version changed. A valid create uses a stable
private idempotency key, rereads the created event from Google, appends one private Promotion
journal record, then Refreshes the verified event into the workspace. A safe retry reports
`retry` without creating or journalling twice. Human and `--json` reports distinguish `promoted`,
`stale`, `blocked` and `retry`; stale or blocked results exit 3.

For a `routine-migration` Proposal, Promotion moves each approved recurring master by its exact
Academic and Routine IDs, verifies the resulting series and exceptions, journals the batch once,
then Refreshes. It never promotes entries listed as requiring a human decision.

## Tasks provision

Preview the module's Google Tasks list:

```sh
node dist/src/cli.js tasks provision --config academic-os.config.json \
  --semester Y2S1 --module MODULE_CODE
```

The command reports what it would do — `would adopt` for a list titled exactly the module code,
`would create` for a missing one — and creates nothing and writes no register. Adding `--apply`
adopts or creates the list and writes `00 Module Admin/30 Task Register.yaml` carrying its exact
ID.

Seeding writes the register before the list exists, so a register naming no list is one waiting
for this command: provisioning adopts or creates the list and writes the ID into the skeleton it
finds, keeping any rows already there.

Rerunning is safe. Once the register names a list, provisioning verifies that list still exists,
reports `bound` and leaves the register's rows alone — the persisted ID is the module's task-list
identity from then on, and a retitled list stays the same list. Two lists sharing the module code
is a conflict the Owner resolves in Google; a register naming a list Google no longer has fails
rather than silently adopting a different one.

## Tasks refresh

Pull the live lists of the whole monitoring cohort into their registers:

```sh
node dist/src/cli.js tasks refresh --config academic-os.config.json
```

Refresh uses only scheduled-read credentials and never writes to Google. The live list wins for
every task Google knows: ticks, retitles and do-date changes land in the register, and a task
created on the phone arrives as a new row. A row Google no longer has becomes `cancelled` rather
than disappearing, and a row with no `task_id` — one an interactive session wrote but has not
pushed — survives untouched. Provenance is the register's own, and a pull preserves it.

Cancellation reaches the rows the register holds, so it takes two pulls to see: the one that first
mirrors a task, then the one after it was deleted. A task created and deleted between the same two
pulls never enters the register at all — a `cancelled` row exists to explain where a tracked task
went, and inventing one for work the register never saw would say the opposite.

Add `--semester` and `--module` to refresh one module. A nonzero result may still have refreshed
other modules: the named stale modules kept their last-good register and report why. Reading a
stale register is fine when its staleness is named; the register is a mirror, so the fix is a
rerun rather than an edit.

## Tasks operations

Write to a module's live list in session — the pushes an unattended refresh has no authority to
make:

```sh
node dist/src/cli.js tasks create --config academic-os.config.json \
  --semester Y2S1 --module MODULE_CODE --title 'Attempt tutorial 3' --do-date 2026-08-27
```

```sh
node dist/src/cli.js tasks change --config academic-os.config.json \
  --semester Y2S1 --module MODULE_CODE --task TASK_ID --do-date 2026-08-28
```

`tasks complete` and `tasks cancel` take the same `--task` and nothing more. Every operation
pushes with the interactive-write credential, reads the live result back, then runs the same pull
`tasks refresh` runs with the scheduled-read one — so the register only ever mirrors what Google
accepted, and the Owner's phone has it first.

`create` also takes `--notes` and the provenance flags `--assessment`, `--source` and
`--milestone`; the returned task ID and that provenance are what the new row carries, and
provenance never reaches Google. `change` takes any of `--title`, `--do-date` and `--notes`. A
`--do-date` is a date with no time: Google discards a time and a Do-date is not a deadline, so the
command refuses one rather than truncating it.

`--task` names a task the register already has a row for. A task created on the phone since the
last pull parks until `tasks refresh` mirrors it — pushing to an ID the register does not know
would be writing blind — and a row the register holds as `cancelled` parks too, because Google no
longer has that task and a cancelled task is never re-pushed. `tasks cancel` deletes the task in
Google, and the refresh behind it marks the row `cancelled`; the register never drops a task it
tracked.

Three outcomes, and the difference between them is what Google did:

- `applied` — pushed, verified, register refreshed. A verified push whose refresh then failed also
  reads `applied`, against a `stale` register a rerun of `tasks refresh` settles.
- `parked` — Google refused the push. The live list is as it was and the register kept no row for
  work that does not exist. Nothing queues it: Google's own apps are the manual fallback, and the
  register catches up at the next pull.
- `unverified` — Google took the push and the live result then read back as something else. The
  report names the task ID, because the task is on the phone; `tasks refresh` mirrors whatever
  Google actually holds.

Anything but `applied` against a fresh register exits nonzero.

Supervise the first live round-trip: `tasks create` against a real module list, tick the task in
Google Tasks on the phone, then `tasks refresh`. The row should come back `completed` with its
provenance intact and no other row moved.

## Operations server

The mini serves this repository's task operations to every machine on the Tailnet, so an agent in
a module folder anywhere reaches them with no clone, no Node and no credential file. Build the
current CLI, then install the resident per-user LaunchAgent from this checkout:

```sh
npm run build
node scripts/install-operations-server-launchd.mjs \
  --config /private/path/academic-os.config.json
```

`--dry-run` prints the plist it would install and installs nothing. The job is resident rather
than scheduled: launchd starts it at login and restarts it whenever it stops, so a rebooted mini
is reachable again without anyone starting it. It writes only
`~/Library/LaunchAgents/com.jerome-group.academic-os.operations-server.plist`, and logs to
`~/Library/Logs/academic-os/operations-server.log`.

The server binds the mini's tailnet addresses and only those, on port `8765`, and serves MCP over
Streamable HTTP at `/mcp`. A mini signed out of Tailscale has no address to bind and the server
refuses to start, which is the intended failure:
reachability on the Tailnet is the whole of the authorisation, and there is no token to add
(ADR-0011). Second machines register the URL once at user scope — `machine-setup.md` is their
whole checklist.

Four tools are served, and each one is the operation of the same name run on the mini:
`tasks_create`, `tasks_change`, `tasks_complete` and `tasks_read_register`. The three writes
follow the Promotion pattern exactly as the CLI does; `tasks_read_register` pulls the live list
into the register first and returns the rows with their provenance. Every tool takes `semester`
and `module`, and a module the config does not map is refused rather than guessed at. An
operation that did not apply comes back as an MCP error carrying the same report the CLI prints,
so a parked push is visible to the calling agent without it having to read the report for the bad
news. A verified push whose refresh then failed is not one of those: the task is on the phone, the
report names the stale register, and reporting it as an error is what would invite a second push.

Inspect the loaded job, watch it serve, and restart it:

```sh
launchctl print "gui/$(id -u)/com.jerome-group.academic-os.operations-server"
```

```sh
launchctl kickstart -k "gui/$(id -u)/com.jerome-group.academic-os.operations-server"
```

Verify from a second tailnet machine rather than from the mini — reaching it over the Tailnet is
the thing being tested:

```sh
curl -s -X POST http://<mini-magicdns-name>:8765/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Then create a task through the tool surface, watch it appear in Google Tasks on the phone, and
read the register back: the row should carry the returned task ID and the provenance Google never
saw.

Remove the exact job and plist:

```sh
node scripts/install-operations-server-launchd.mjs --remove
```

## Textbooks shelf migration

The one-time pass that brings an existing shelf into the system, in the order the index depends on:
sweep, one review, renames, then the index. It is run once, before the first catch-up.

Sweep the shelf into a review sheet:

```sh
node dist/src/cli.js textbooks sweep --config academic-os.config.json
```

The sweep reads the shelf and writes nothing but the sheet, at
`stateRoot/textbooks/shelf-review.yaml`. It refuses to overwrite a sheet that is already there,
because the second the sheet exists it is the Owner's working copy. Every book the index does not
already name gets a line carrying its filename, its checksum and the Book key the sweep derived —
and where the sweep cannot derive one, a `SETTLE` comment saying what to decide. Three things ask:
a name the codified naming does not accept, a default key another book already holds, and bytes a
book already on the shelf carries.

Settle the sheet. `rename` is the filename the book should end up carrying and is left blank to
keep the name it has; `key` is the Book key the Shelf index will hold it under. A key is immutable
once a chapter filename cites it, so a collision is qualified here once — `Isaacs_FGT` beside
`Isaacs_CT` — and never again. A blank key is unsettled and the migration refuses to run.
`division` — the book's own word for how it divides itself — is asked of nobody and blank is the
expected answer: no filename carries it and the first cut from a book without one parks until the
Owner records it (ADR-0009). The sheet takes one where the Owner already knows it, which is the
only saving on offer without opening the book.

The settled collision keys and the approved renames are what the migration was authorised by, so
they are recorded on the issue that ordered the migration — the sheet itself never leaves private
state.

Preview the settled sheet:

```sh
node dist/src/cli.js textbooks migrate --config academic-os.config.json
```

The preview holds the sheet against a fresh listing and a fresh checksum of every book in it, and
reports everything left to settle at once rather than one problem per run. A shelf that has moved
under the sheet — a book arrived, a book left, a copy was replaced — blocks the whole run, and the
answer is to delete the sheet and sweep again. So does a rename that would land on a book that is
still there, a rename that still does not follow the codified naming, and a key another book or an
existing entry already holds. Blocking exits nonzero and touches nothing.

Apply it once the preview is clean:

```sh
node dist/src/cli.js textbooks migrate --config academic-os.config.json --apply
```

Renames run first and the index last, because the index records final filenames. Every rename is a
write to the Owner's own books, so each one refuses a target anything on the shelf already carries
rather than replacing it, and each is journalled to `stateRoot/journals/textbooks/migration.jsonl`
before and after it happens — a run that dies mid-pass leaves the exact list of books that moved.
Nothing outside the sheet is renamed, and no path in the command deletes anything.

Verify with a catch-up: after a clean migration `textbooks catch-up` has nothing to append and
nothing to park, which is the baseline the daily pass runs against from then on.

## Textbooks catch-up

Diff the Textbook shelf against its Shelf index. The default is a non-mutating preview:

```sh
node dist/src/cli.js textbooks catch-up --config academic-os.config.json
```

Review what it would append, then add `--apply`. An append lands beneath the entries already
there, comments and ordering intact; renaming or removing an entry is the Owner's own edit, and
the command has no path that does either.

A book is appended when its filename follows `<Title> <N>e <Author surnames, comma-separated>.pdf`
— the edition token only where the book has one, `Solutions` trailing a solutions manual — and its
default Book key, the first author's surname, is free. Three things park instead: a name the
codified naming does not accept, a key an entry already holds, and bytes already indexed under
another name. Parking exits nonzero and stops nothing else: the clean books of the same run are
appended, and the parked ones wait for the Owner. A book renamed on the shelf therefore parks as a
duplicate rather than moving its entry.

An appended entry carries no `division`. The book's own word for how it divides itself — Chapter,
Lecture, Part — is in the book rather than in its filename, so the Owner records it once and the
first chapter cut from that book parks until they do (ADR-0009).

The shelf's `Archive/` is invisible to the catch-up, retired books and all — as is any other folder
on the shelf, so books live directly on it. Everything else sitting directly on the shelf is read as
a book, so anything there that is not a cleanly named PDF parks on every run until it is renamed or
archived. Two exceptions are the mount's own artifacts rather than anything the Owner put there:
dot-files, and the `Icon\r` that whatever set a folder's icon writes back. Neither is a park the
Owner could ever clear, so neither is one (ADR-0010).

A book the index already names by filename is left unread, which is what keeps a run from pulling
the whole shelf down the Drive mount. Replacing a copy in place under its old name therefore leaves
its entry and its old checksum standing; the disagreement surfaces at the next cut from that book,
where the Textbook procedure verifies the checksum before it cuts.

## Morning routine

One firing curates overnight arrivals across the monitoring cohort and leaves the Owner either
silence or a single issue. Run it by hand on the mini to watch it:

```sh
node dist/src/cli.js routine morning --config academic-os.config.json
```

The order is fixed and every step is isolated from the next. First the deterministic prelude: the
Shelf catch-up applies its clean appends and parks the rest, then every cohort module's Task
register is pulled from its live list. Then one headless Codex session per module, in sequence, each
running that module's own seeded curation procedure in its own folder. A session that fails, breaks
or hangs past twenty minutes becomes a failure line and the next module starts; there is no same-day
retry, because tomorrow's pass is idempotent and self-heals. The routine never compiles LaTeX, never
creates a task, and never writes to Google.

Each session runs on `gpt-5.6-luna` at maximum reasoning effort, sandboxed to the module folder it
was pointed at and nothing wider. Model, effort and sandbox are all stated on the command line
rather than taken from the machine's `~/.codex/config.toml`, so retuning Codex for something else on
the mini cannot change what curates the degree. The pass reports through its final message, which
the CLI validates against a schema and writes to `result.json` itself — the model is never asked to
remember a file (ADR-0018).

Then the routine purges its own exhaust — session directories older than seven days, reports older
than thirty — and writes the day's report.

### What lands where

Under `stateRoot`, both named by the offering's calendar day:

- `routine/reports/<date>.md` — the morning's full report, every day, in one fixed format: the
  prelude's two steps, then per module its curated, rederived, superseded, withdrawn, parked, doc
  writes, failures and noted, then what the purge removed.
- `routine/sessions/<date>/<module>/` — that pass's `result.json`, the `result-schema.json` it was
  held to, and its `session.log`. The report is built from the result; the log is there for the
  morning the result is the argument (ADR-0018).

Nothing outside those two directories is ever purged, and inside them only entries named for a
calendar day are (ADR-0018).

### The morning's issue

When the morning parked something, wrote a module `CONTEXT.md` or ADR, or hit a failure, the routine
raises **one** issue on this tracker titled `Morning report <date>`, labelled `ready-for-human` and
`decision`, carrying the same report text as its body. It searches for that title before creating,
so a second firing on the same day finds the first issue rather than raising another. A morning with
none of those three raises nothing — silence is the good outcome, and the report still lands.

A pass's `noted` bucket is the one that never raises. It carries what the morning observed and
settled — a placed copy that has diverged from its source and is holding its ground, say — so a
morning whose only news is a note stays quiet and the note waits in the report
([`docs/adr/0021-…`](adr/0021-a-note-is-told-and-a-park-is-settled.md)).

A run that never fired, or one that could not reach GitHub, looks from the Owner's side exactly like
a quiet morning. That ambiguity is accepted for now; the report on the mini is what distinguishes
them, and the exit code is nonzero when the morning had something to say and no issue carries it.

### Install the 06:00 LaunchAgent (macOS)

Build first, then preview the job:

```sh
node scripts/install-morning-routine-launchd.mjs --config "$PWD/academic-os.config.json" --dry-run
```

Then install it. The Mac's timezone must be `Asia/Singapore`; the installer refuses otherwise, since
the schedule is pinned to the offering's clock:

```sh
node scripts/install-morning-routine-launchd.mjs --config "$PWD/academic-os.config.json"
```

It writes `com.jerome-group.academic-os.morning-routine` into `~/Library/LaunchAgents`, boots out any
running copy first, and bootstraps the new plist into the user's GUI domain. `StartCalendarInterval`
at 06:00, `RunAtLoad` false, both streams to `/dev/null` — the dated report is the record. launchd's
stock coalescing applies: a slept-through 06:00 runs once on wake, and time powered off or logged
out is not made up.

The 05:00 Calendar Refresh is a separate LaunchAgent and this installer never touches it.

```sh
node scripts/install-morning-routine-launchd.mjs --remove
```

Force a run without waiting for tomorrow:

```sh
launchctl kickstart -k gui/$(id -u)/com.jerome-group.academic-os.morning-routine
```

## Seed

Supply an approved Profile and Definition. The default is a non-mutating preview:

```sh
node dist/src/cli.js seed --config academic-os.config.json \
  --profile /path/to/approved-profile.md \
  --definition /path/to/approved-definition.yaml
```

Review every operation, then add `--apply`. Apply is additive: any conflict blocks publication;
existing content is never overwritten, moved, renamed or removed. A new module becomes visible at
its final code only through one atomic rename of its complete validated staging tree. An
interrupted apply retains its append-only journal under `stateRoot`. Rerun without `--resume` to
recheck the target and show completed/remaining operations; continue only when it reports
`safely-resumable`, using `--apply --resume`. Keep that journal as recovery evidence until the
result is settled.

Every seed includes `CONTEXT.md` as the module glossary and an initially empty `docs/adr/` for
decisions; an empty ADR directory means no qualifying decision has yet been recorded. It also writes
the six pinned files — the `AGENTS.md` router, the four `docs/` procedures and the teaching
preferences in `70 Learning/templates/` — from this repository's `seed-templates/`, with
`MODULE_CODE` replaced by the module's code. They are the module's whole instruction set, and audit
diffs each copy back against its template, so a module that needs to say something of its own says
it in `CONTEXT.md`, `docs/adr/` or the Profile.

The Teaching workspace is seeded whole, for every module, whether or not that module will use it:
the four activity areas under `70 Learning` with their `records/`, the LaTeX template set and
teaching preferences in `templates/`, and `GLOSSARY.md`, `RESOURCES.md` and `REVISIT.md`. Beside
them in Module Admin, `40 Source Map.yaml` is seeded declaring no units; the Lecture-units the
workspace reads it for are filled in from the module research. `30 Task Register.yaml` is seeded the
same way — `tasks: []` and no list, which `tasks provision` fills — and `50 Textbook Register.yaml`
as `extractions: []`, which the Textbook procedure appends to as chapters are cut off the shelf. The
eight files in `templates/` are required by name, so the set survives; a `.tex` among them is the
module's to edit where the difference is functional, so audit checks that it is there rather than
diffing it back. `preferences.md` is the exception and is diffed, under MF-AGENTS-004 with the rest
of the pinned set.

## Audit

`audit --config academic-os.config.json` selects only the configured active cohort. Name both
`--semester` and `--module` for an explicit read-only target, including a past module used for
acceptance evidence. Add `--migration` only when a configured past module should receive
historical-migration interpretation; it never enrols or changes the module.

Human output is the default. `--json` emits the versioned report used by automation. Both expose
the same findings, applicability, evidence and enforcement:

| Exit | Meaning |
|---:|---|
| 0 | Conformant or advisory-only |
| 1 | Contract deviation |
| 2 | Unsafe/incomplete inventory, configuration or operation |
| 3 | Human decision or manual review required |

Every audit appends a complete private observation under `stateRoot`; reports and observations
contain metadata and filenames, so do not commit them. Current mismatch is a **deviation**. Only a
change between compatible observations is **drift**. A historical contract gap or contract-version
upgrade is migration evidence, not permission to repair or change the contract.

## Pinned refresh

A change to any file under `seed-templates/` leaves every module's copy stale, which audit reports
as MF-AGENTS-004. `pinned refresh` is the repair that rule names, over the active cohort audit
already selects. It reads the templates from the checkout it runs in, so run it once the change is
merged: a module's agents follow the copy in their own `docs/`, and an amended procedure governs
nothing in the cohort until this has rewritten them.

```bash
node dist/src/cli.js pinned refresh --config academic-os.config.json
```

That previews. It says, for every module and pinned document, whether the copy is current, stale or
missing, and for a stale one it names the first differing line — the same words the audit's own
finding uses. Read it before applying: a module's local edit to a pinned file is exactly what this
discards, and MF-AGENTS-004 is why that is right, but the preview is what stops it being silent.
Whatever a module needed to say belongs in `CONTEXT.md`, `docs/adr/` or the Profile.

```bash
node dist/src/cli.js pinned refresh --config academic-os.config.json --apply
```

| Exit | Meaning |
|---:|---|
| 0 | Every pinned copy is current |
| 1 | A copy is stale or missing, and `--apply` would rewrite it |
| 2 | The run was refused, stopped part-way, or a module could not be read |

Each write proves itself before it happens, under `docs/agents/safe-drive-testing.md`: the target
resolves inside the Drive mount, it is an ordinary file rather than a symlink, it holds real bytes
rather than a dataless placeholder, and its checksum still matches what the preview read. A target
that disagrees refuses the **run**, not the one file, and the whole proving pass finishes before
anything is written. A copy that is there arrives through a temporary and one rename, so no reader
meets it half-written; one that is missing is created exclusively, so a name that filled in since
the preview is never clobbered.

Should a write still fail after earlier ones have landed — an unwritable folder, a full disk — the
run stops and reports `partially-rewritten`. Nothing can unwrite the copies already replaced, so the
journal is the record of exactly how far it got. A module the cohort names but that cannot be read
is listed as `Unresolved` and does not stop the others; the run exits 2 to say so.

Every rewrite is journalled under `stateRoot` at `journals/pinned-documents/<run>.jsonl`, carrying
the checksum replaced and the checksum written. A cohort that was already current writes no journal
at all.

## Curation register identity

A register line written before contract v4 is keyed by a Drive file ID and an md5. Contract-v4
identity is the **unnumbered source path** — the item's path inside its importer root with the `NN `
ordering stripped from every segment — and a **sha-256** the pass computes. A legacy line matches an
arrival walk on neither half, so the item reads as a fresh arrival every morning and is decided
again. `curation migrate` is the reviewed pass that finishes that migration once, over the same
active cohort audit already selects:

```bash
node dist/src/cli.js curation migrate --config academic-os.config.json
```

That previews. It says, per module, how many standing lines still carry legacy identity, what each
one becomes, and which ones it will not touch. Read it before applying — the register is history,
and what this appends to it is permanent.

```bash
node dist/src/cli.js curation migrate --config academic-os.config.json --apply
```

Applying **appends**: each migrated item gains a line carrying contract-v4 identity, the decision
and destination of the line it supersedes, and that line's identifier in `supersedes`. Nothing
already written is edited, so the register stays append-only history and a second run over it plans
nothing further — [`docs/adr/0019-…`](adr/0019-register-identity-migrates-by-superseding-and-decides-nothing-else.md).

Identity moves forward only where the recorded checksum still matches the source bytes. Three kinds
of item are reported and deliberately left alone:

| Reported | The item | Who settles it |
|---|---|---|
| `changed` | Its source bytes differ from the checksum the standing line recorded | The curation walk, as an update arrival |
| `missing-source` | Nothing in the mirror answers to its unnumbered path | The curation walk, as a withdrawal |
| `unprovable` | Its standing line records no comparable checksum, or two files answer to its path | The Owner |

An item the walk has already withdrawn is closed and drops out of these counts altogether, legacy
lines and all — [`docs/adr/0020-…`](adr/0020-a-source-that-has-left-the-mirror-is-withdrawn.md).

| Exit | Meaning |
|---:|---|
| 0 | Every line an arrival walk can meet carries contract-v4 identity |
| 1 | Legacy lines remain, and `--apply` would migrate them |
| 2 | The run was refused, stopped part-way, a module could not be read, or a register is malformed |
| 3 | Nothing left to migrate, and items only a decision or a walk can settle remain |

Sources are looked up by their unnumbered path rather than by the path the standing line recorded,
because that number is exactly what shifts when an importer renumbers a folder — an item filed under
`03` and now under `04` still migrates, and the new line records where it actually is.

Each write proves itself before it happens, under `docs/agents/safe-drive-testing.md`: the module is
materialized before any source is hashed, the register resolves inside its own module folder on the
Drive mount, it is an ordinary file, and its checksum still matches what the preview read — as does
every source the run is about to name. Anything that disagrees refuses the **run**, not the one
module, and the whole proving pass finishes before anything is written; the new contents arrive
through a temporary and one rename, so no reader meets the file half-written. Every append is
journalled under `stateRoot` at `journals/curation-identity/<run>.jsonl`, carrying the checksum
replaced and the checksum written.

## Curation register split sources

One source can be worked into several module artifacts — a combined document cut into a chapter
apiece — and MF-CURATION-005 is the one `rederived` line that records it. A register holding a
`curated` line per artifact instead reports a divergence every morning that nothing can settle.
`curation rederive` is the reviewed pass that corrects those registers, over the same active cohort
audit selects:

```bash
node dist/src/cli.js curation rederive --config academic-os.config.json
```

That previews. It names, per split source, which destinations become `derived`, which stay
`curated` because they hold the source's own bytes, and which the run could not read or could not
find — read it before applying, because the register is history and what this appends to it is
permanent.

```bash
node dist/src/cli.js curation rederive --config academic-os.config.json --apply
```

Applying **appends** one `rederived` line per corrected source, naming the derived artifacts and
carrying the superseded batch's identifier in `supersedes`. Nothing already written is edited, so a
second run plans nothing further — the item's standing batch is now the `rederived` line, and that
is not a split — [`docs/adr/0022-…`](adr/0022-a-source-cut-into-many-artifacts-is-one-rederived-decision.md).

The correction is decided per destination and not per source, because a source cut into chapters is
often also placed whole. A destination whose bytes are the source's is a copy, and its `curated`
line stays standing beside the appended one. A destination the mount does not hold is named and left
out of `derived`, and a standing line whose own digest cannot be read costs only its own destination
— refusing the item over one bad character would leave the whole source reporting every morning.

Four kinds of source are reported and deliberately left alone:

| Reported | The source | Who settles it |
|---|---|---|
| `changed` | Its bytes differ from the sha-256 its standing lines recorded | The curation walk, as an update arrival |
| `legacy-identity` | Its standing batch is keyed by a Drive file ID | `curation migrate`, first |
| `missing-source` | Nothing in the mirror answers to its unnumbered path | The curation walk, as a withdrawal |
| `unprovable` | No standing line records a sha-256 this pass can compare | The Owner |

| Exit | Meaning |
|---:|---|
| 0 | No standing batch records one source as a curated line per artifact |
| 1 | Split sources remain, and `--apply` would correct them |
| 2 | The run was refused, stopped part-way, a module could not be read, or a register is malformed |
| 3 | Nothing left to correct, and sources only a decision or a walk can settle remain |

Each write proves itself before it happens, under `docs/agents/safe-drive-testing.md`: the module is
materialized before anything is hashed, the register resolves inside its own module folder on the
Drive mount, it is an ordinary file, and its checksum still matches what the preview read — as does
every source the run is about to name. Anything that disagrees refuses the **run**, not the one
module. Every append is journalled under `stateRoot` at
`journals/curation-rederivation/<run>.jsonl`, carrying the checksum replaced and the checksum
written.

## Transition a module to the current contract

A module folder whose Definition declares an earlier contract version audits as
`contract-version-upgrade`. That lag is the queue, and working through it is **transition**
(MF-TRANSITION-001) — the lighter path beside repair, one module at a time in an interactive
session:

1. Audit the module and read the difference between the current contract's structure and what the
   folder holds.
2. Draft where each module-local item the pinned files cannot keep is re-homed — organisational
   terms to the module `CONTEXT.md`, standing rules to a module ADR, module facts to the Profile.
3. Show the Owner the difference and the re-homing plan together; their yes on that module is the
   approval to apply it.
4. Apply under `docs/agents/safe-drive-testing.md`. Transition writes this repository's control
   files and moves documents; it reads academic contents and leaves them where they are, so it
   needs neither the recovery snapshot nor the Drive-ID inventory repair binds.
5. Move the Definition's `contract_version` last, once the structure it declares is there.

## Repair one historical module

Repair accepts a private, versioned plan whose digest binds the approved decisions, complete Drive
inventory, item IDs, capabilities, preconditions, ordered destinations and curation events. Keep
plans outside git. Preview re-inventories Drive and changes nothing:

```sh
node dist/src/cli.js repair --config academic-os.config.json \
  --plan /private/path/approved.repair-plan.json
```

Apply only after reviewing that exact plan. Before the first live operation, repair recursively
creates and verifies an ID-mapped Drive copy and a SHA-256 byte snapshot on the configured separate
volume. The byte snapshot is made read-only and user-immutable on macOS. This is strong operational
protection, not regulatory WORM: an administrator can remove the immutable flag.

```sh
node dist/src/cli.js repair --config academic-os.config.json \
  --plan /private/path/approved.repair-plan.json --apply
```

Every operation is journalled before and after its Drive call. If interrupted, rerun without
`--resume`; the command reconciles operation tags and stable IDs, then reports whether continuation
is safe. Continue only from `safely-resumable`:

```sh
node dist/src/cli.js repair --config academic-os.config.json \
  --plan /private/path/approved.repair-plan.json --apply --resume
```

Repair creates folders/files, relocates existing IDs, or moves recovery-only originals into the
verified retirement root. It never calls permanent delete, moves content to Trash, overwrites a
destination, or uses a path as Drive mutation identity. Approved local-only Finder artifacts are
removed from the mount only after their device, inode, timestamp, size and SHA-256 match the plan
and their byte recovery verifies. A complete repair writes its curation events, re-inventories the
module and reruns contract conformance.

For the historical rollout, operate MH1100 first and CC0015 second. Do not begin the other fourteen
Y1S1/Y1S2 modules until both pilots have completed and passed a fresh migration audit. Google-native
files are recovered as recorded exports subject to Drive export limits; the additional Drive copy
is mutable and therefore is not itself immutable or WORM storage.

## Operate safely

- Preview is non-mutating; apply requires the explicit flag.
- Calendar setup preview never mutates Google; apply may create only missing secondary Owned
  calendars.
- Calendar refresh uses only read-only event authority and never mutates Google.
- Calendar propose uses only read-only authority and writes only private Proposal state.
- Tasks refresh is pull-only; the task operations are the one Tasks path that writes to Google, and
  they run in session under the interactive-write credential, never unattended.
- Audit has no repair path and no write-capable Drive API dependency.
- A contract change edits `docs/module-folder-contract.md`; repair resolves only an approved
  deviation and cannot change the contract.
- Transition brings one folder to the current contract version on the Owner's yes and leaves
  academic contents where they are.
- Curation migrate only appends to a register, and never decides an item whose source bytes have
  changed — that is an update arrival for the curation walk.
- Curation rederive only appends to a register, and moves no artifact: it corrects what a decision
  said, never where anything sits.
- Run `npm run check`, `npm run rule-coverage:check` and `npm run privacy:check` before publication.
- Follow `docs/agents/safe-drive-testing.md` before any Drive write or integration test.
