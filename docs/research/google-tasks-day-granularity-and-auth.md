# Google Tasks: day granularity, per-module lists, auth, second machine

Research date: 2026-08-14 (Asia/Singapore). Resolves the research question of issue #66.

## Primary sources

- [Tasks resource reference](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks) —
  the `due` field and field-length limits.
- [tasks.insert](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/insert) —
  per-list and per-account task limits, write scope.
- [tasks.list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list) —
  paging defaults, due-window filters, read scopes.
- [TaskList resource reference](https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists) —
  list title limit.
- [tasklists.insert](https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists/insert) —
  the 2,000-list cap, write scope.
- [tasklists.list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists/list) —
  paging, read scopes.
- [Tasks API quotas and usage limits](https://developers.google.com/workspace/tasks/limits) —
  daily query quota.

## (a) Due dates are date-only — confirmed

The `Tasks` resource documents `due` as an RFC 3339 timestamp of which "Only date information is
recorded; the time portion of the timestamp is discarded when setting this field. It isn't
possible to read or write the time that a task is scheduled for using the API." The field is
described as the day the task should be done or is visible on the calendar grid, not a deadline
instant.

Consequences for a per-module task register:

- The API's contract is exactly the Owner's day-granularity design. A register that stores
  `YYYY-MM-DD` loses nothing on the way to Google and reads back what it wrote.
- Any time-of-day a task shows in Google's own UI is invisible through the API, so the register
  must never be asked to preserve one.
- `tasks.list` filters by due window (`dueMin`/`dueMax`, both RFC 3339), which is sufficient for
  day-window queries such as "due this teaching week".
- Timed deadlines therefore stay where they already live: the Calendar side of this system
  (ADR-0006). Tasks and Calendar split cleanly on granularity.

## (b) One task list per module — workable, with IDs persisted

- **Number of lists:** `tasklists.insert` documents "A user can have up to 2000 lists at a time."
  A degree's worth of modules (single digits per semester) is nowhere near it.
- **Naming:** a `TaskList.title` allows up to 1,024 characters and is free-form. Nothing enforces
  uniqueness, so — as the Calendar setup already does for calendar IDs — the system must persist
  the exact task-list ID it created and never resolve a list by title.
- **Listing:** `tasklists.list` returns up to 1,000 lists per page (default 1000), so every
  per-module list is visible in a single page.
- **Per-list capacity:** `tasks.insert` documents "A user can have up to 20,000 non-hidden tasks
  per list and up to 100,000 tasks in total at a time." Task `title` is capped at 1,024
  characters and `notes` at 8,192.
- **Reading a register:** `tasks.list` pages at "The default is 20 (max allowed: 100)", so a
  register reader paginates exactly as the calendar client already does for events.
- **Quota:** the API "has a courtesy limit of 50,000 queries per day" per project — far above a
  daily refresh plus interactive use.

## (c) The existing auth pattern extends — new consent, no new machinery

The Calendar clients build a `GoogleAuth` from `google-auth-library` with an explicit `keyFile`
pointing at a credential path named in the gitignored private config
(`calendar.credentials.scheduledRead` / `interactiveWrite`), one file per role. Those files are
`authorized_user` JSON (client id, client secret, refresh token) minted by
`scripts/authorize-calendar-credentials.mjs`, a Node-only loopback OAuth flow with PKCE.

That pattern carries over to Tasks unchanged in kind, with two things to know:

1. **Scopes live in the consent, not the code.** An `authorized_user` refresh token is bound to
   the scopes granted when it was minted; the `scopes` array passed to `GoogleAuth` cannot widen
   it. Extending to Tasks therefore means running the (generalised) authorize helper again with
   the Tasks scope included and writing new credential files — the client code and config shape
   need nothing structurally new, only new paths (e.g. `tasks.credentials.scheduledRead` /
   `interactiveWrite`).
2. **The scope set is small and maps onto the existing split.** Tasks has exactly two scopes:
   `https://www.googleapis.com/auth/tasks` (read/write; the only scope `tasks.insert` and
   `tasklists.insert` accept) and `https://www.googleapis.com/auth/tasks.readonly` (accepted by
   `tasks.list` and `tasklists.list`). Scheduled-read gets `tasks.readonly`; interactive-write
   gets `tasks`. There is no finer granularity (no per-list or events-only scopes as Calendar
   has), so the write credential necessarily covers all of the account's tasks.

One console step: the **Google Tasks API must be enabled** on the Cloud project that owns the
Desktop-app OAuth client(s), and the Tasks scopes added to that project's OAuth consent screen —
both done in the Google Cloud web console, exactly as was done for Calendar. No command-line
tooling is involved.

## (d) Second machine: Node plus the private files — no gcloud

**`gcloud` is not needed, on any machine.** Nothing in this repository uses Application Default
Credentials or any gcloud-managed state: every client is constructed from an explicit credential
file path, and `google-auth-library` is an ordinary pinned npm dependency
(`package.json`). The authorize helper is likewise plain Node (`node:http` loopback +
`OAuth2Client`); gcloud's only role in Google auth is minting ADC files, which this design
deliberately replaced with its own credential files.

A second machine needs:

1. **Node.js >= 24** (the `engines` pin) with npm — this also covers building and running the
   CLI (`npm ci && npm run build`).
2. **A clone of this repository.**
3. **The private config file** (gitignored; shaped like `academic-os.config.example.json`) with
   credential paths valid on that machine.
4. **Credentials**, one of two ways:
   - copy the existing `authorized_user` credential files to the configured paths (they are
     machine-independent JSON), or
   - copy only the OAuth *client* files and mint fresh refresh tokens locally by re-running the
     authorize helper — needs only Node and a browser for the approval page.

`jq` is used by the interactive bootstrap wizard (`scripts/setup-calendar-local.sh`), not by the
CLI; a second machine that receives ready-made credential files does not need it.

## Decision-ready summary

Google Tasks fits the day-granularity register exactly — the API cannot even express a due time —
and one list per module is comfortably inside every documented limit provided the system persists
exact list IDs. Auth is the Calendar pattern re-run with the two Tasks scopes (readonly for
scheduled read, full for interactive write) into new credential files, plus enabling the Tasks API
in the web console. A second machine needs Node >= 24, the repo, the private config and the
credential files — and nothing from gcloud.
