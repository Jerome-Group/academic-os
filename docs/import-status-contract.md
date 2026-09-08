# Import status receipts

`Sync status.json` is importer-owned operational metadata at the root of one NTULearn
destination. NTULearn writes it; Academic OS reads it. It records one attempt and a retained
successful-attempt timestamp, independently of the human-facing `Last synced.md`.

This document owns the v1 interface. Both repositories test the synthetic example at
`test/fixtures/import-status-v1.json`; changing its shape requires coordinated producer and
consumer tests. Folder contract and receipt versions are independent.

## Version 1

```json
{
  "schemaVersion": 1,
  "producer": "ntulearn",
  "status": "complete",
  "startedAt": "2026-09-08T00:00:00.000Z",
  "finishedAt": "2026-09-08T00:01:00.000Z",
  "lastSuccessfulAt": "2026-09-08T00:01:00.000Z",
  "counts": {
    "downloaded": 2,
    "skipped": 3,
    "markdown": 4,
    "uncopied": 0,
    "failures": 0
  },
  "unread": []
}
```

The object and `counts` have exactly these fields. The UTF-8 JSON document is at most 16 KiB.
Counts are nonnegative safe integers. `markdown` counts expected ordinary Markdown documents,
including unchanged documents; it is the existing sync tally, not `markdownWritten`.
`uncopied` counts stand-ins for items with nothing downloadable. Neither operational file
contributes to these counts. `failures` counts failed attachment transfers; a thrown read or
filesystem error is represented by `failed`, even when this count is zero.

`unread` is a sorted, duplicate-free subset of `announcements` and `conversations`. These name
unavailable optional reads, not empty categories. New categories or fields require a new version.
No course identifier, path, URL, source text or raw exception belongs in a receipt.

Timestamps are canonical UTC instants as emitted by `Date.toISOString()` with four-digit years
and millisecond precision. They must parse to that exact string and must not lie after the
reader's observation time. `finishedAt` must be at or after `startedAt`. A retained
`lastSuccessfulAt` must be at or before `startedAt`, except for `complete`, where it must equal
`finishedAt`.

## Lifecycle

| Status | Meaning | Required fields |
| --- | --- | --- |
| `running` | Published atomically before reading the course | `finishedAt: null`, zero counts, empty `unread` |
| `complete` | The walk and writes returned with zero transfer failures and no unread categories | Non-null `finishedAt`; `lastSuccessfulAt` equals it |
| `partial` | The walk returned with transfer failures or unread categories | Non-null `finishedAt`; at least one failure or unread category |
| `failed` | A read, walk or write threw before successful terminal publication | Non-null `finishedAt`; no raw exception |

Before `running`, validate the prior receipt against this interface and the new attempt's
start time. Preserve its `lastSuccessfulAt` only when valid; otherwise use `null`. Only
`complete` advances that timestamp. An interrupted process leaves `running`. If publishing a
terminal receipt fails, the attempt remains unsuccessful and its error propagates; publishing
`failed` must preserve the original course error if that publication also fails.

Each publication replaces the receipt atomically. A reader sees a whole old or new document.
The receipt is a last-writer observation: overlapping manual and scheduled syncs are not
serialized by this interface. `lastSuccessfulAt` is the success recorded by this attempt when
complete, or the value preserved from the receipt it read at startup. Overlapping attempts can
therefore replace a newer retained success with an older one or `null`; the field is not a
monotonic history across processes. Read the receipt again when freshness matters.

## Interpretation

Academic OS's `imports status` reads only configured active Module targets and their
Definition-declared importer roots. It reports the lifecycle status directly, except a
`complete` receipt becomes `current` or `stale` using `finishedAt` and the selected maximum age
(36 hours by default, inclusive at the boundary). It shows counts and the last known success.
Missing receipts mean `missing`; malformed, unsupported, future-dated or unreadable evidence
means `invalid`. One broken target retains its siblings' results. Missing or invalid Module
Definitions cannot silently hide additional importer roots.

Exit 0 means every observed root is current and all active targets were resolved; 1 means
attention is needed; 2 means invalid or unreadable input. Human and JSON reports describe the
same observation. The command authenticates nowhere and writes nothing.

The morning routine uses this same assessment with a 24-hour freshness window. A non-current
root raises attention independently of the LLM result and defers withdrawal decisions; other
maintenance continues. This window detects old evidence, not whether a particular scheduled
invocation ran. The standalone command retains its 36-hour default.

A receipt records the result the importer observed. It proves neither exhaustive upstream
visibility nor the current bytes of every file, and it excludes the separately scheduled media
pipeline. A complete receipt is not permission to withdraw sources, overwrite curated work or
skip the module's full curation walk. The existing contract and precedent still govern those
decisions. Reports may be stale immediately after observation, especially across Drive sync.

## Rollout

Deploy NTULearn first; each destination gains its receipt during the next Owner-run or already
scheduled sync. Academic OS can deploy independently: older mirrors report `missing` and remain
valid module folders. Existing Academic OS versions continue to see the receipt as importer-owned
material. No migration, automatic sync, scheduler installation or module-control rewrite is part
of installing the command. The Markdown stamp retains its existing meaning and citation rules.
