# Operator guide

The CLI has `seed`, `audit`, `calendar setup`, pull-only `calendar refresh`, private
`calendar propose`, explicitly authorised `calendar promote` and separately gated
`repair` commands. It does not
schedule weekly LLM work or edit module instructions autonomously.

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
decisions. Generated `AGENTS.md` routes classification, naming and organisation through both; an
empty ADR directory means no qualifying decision has yet been recorded.

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
- Audit has no repair path and no write-capable Drive API dependency.
- A contract change edits `docs/module-folder-contract.md`; repair resolves only an approved
  deviation and cannot change the contract.
- Run `npm run check`, `npm run rule-coverage:check` and `npm run privacy:check` before publication.
- Follow `docs/agents/safe-drive-testing.md` before any Drive write or integration test.
