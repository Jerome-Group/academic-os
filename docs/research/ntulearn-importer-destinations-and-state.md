# What the ntulearn importer writes into an importer root, and what state it keeps

Research for [#65](https://github.com/Jerome-Group/academic-os/issues/65). All ntulearn citations
are pinned to [`Jerome-Group/ntulearn@5ef5254`](https://github.com/Jerome-Group/ntulearn/tree/5ef5254f03878b887be48e7e9682e3c1759f83bd),
read 2026-08-14. The importer's own word for an importer root is **destination**; this file uses
both, and `<drive-mount>` stands for the Owner's Drive path, which stays out of public repositories.

## Conclusion

1. **Destination handling.** The importer writes into exactly one configured folder per NTULearn
   *course site* — the destination — and never outside it. The contract's importer roots reach it
   only as hand-maintained configuration: a git-ignored `config/courses.json` in the importer's own
   checkout maps each site to an absolute path such as `<drive-mount>/…/AB1234/NTULearn`. Nothing
   in the importer reads this repository's contract or a Module Definition; the coupling between
   MF-IMPORTER-001's root names and the importer is convention plus a README recommendation.
2. **State.** There is **no manifest in the mirror**, deliberately. The importer keeps one
   disposable cache outside the module folder (`.data/state.json` in its checkout — per-course
   download records with `sha256`, plus content/announcement/conversation id lists and `syncedAt`),
   one file inside the mirror (`Last synced.md`, a timestamp only), and a per-run stdout report.
   None of these is durable per-curation-pass state, and the importer's glossary explicitly refuses
   the word "manifest" for its state.
3. **"What landed since the last curation pass"** therefore cannot be asked of the importer. It
   *can* be answered without diffing two trees, because of two guarantees the importer does make:
   a sync is **additive** (never deletes, renames or overwrites) and **touches only what changed**
   (unchanged files are never rewritten; only the stamp moves on every run). So one walk of the
   mirror joined against the curation register (MF-CURATION-001's `source_path` + `checksum`) is
   sound, and file mtimes are a usable over-approximation of arrivals. The register — this
   repository's artefact — is the only durable side of that join.
4. **Naming guarantees** inside the mirror are real but weaker than they look: fixed names at the
   root, a deterministic sanitiser, and a `NN ` position prefix that is an **ordering, not an
   identity** — it goes stale when the course reorders and is only repaired by a deliberate,
   manual `renumber` command. A curation register keyed on the full numbered path will drift;
   checksum plus the name *behind* the number is the stable identity.

## Destination handling: which paths it writes, and how importer roots reach it

Configuration is a `config/courses.json` in the importer's checkout, ignored by Git because it
holds the Owner's own paths
([README.md](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/README.md),
"Configuration"). Each entry is `{key, courseId, destination}`; the example ships module-shaped
paths — `…/Modules/Y1S1/AB1234/NTULearn` and `…/AB1234/NTULearn_Tutorial`
([config/courses.example.json](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/config/courses.example.json)).
Loading resolves each destination to an absolute, normalised path and **refuses, at startup, two
courses sharing a destination or nesting one inside another**, compared case-insensitively because
macOS and Drive would merge what a case-sensitive filesystem keeps apart
([src/config.mjs L41–101](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/config.mjs#L41-L101)).

Three consequences for this repository:

- **One destination is one NTULearn *site*, not one module.** A course with a lecture and a
  tutorial site is two entries, and the README's recommended layout — `NTULearn` for the main site,
  `NTULearn_Tutorial` beside it — is exactly MF-IMPORTER-001's universal root plus declared
  `NTULearn_*` roots ([README.md](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/README.md),
  "One folder per NTULearn site, not per course";
  [docs/module-folder-contract.md](../module-folder-contract.md), MF-IMPORTER-001).
- **The contract is an interface the importer meets by hand.** Renaming an importer root in
  `docs/module-folder-contract.md` changes nothing in ntulearn automatically; the Owner edits every
  affected `destination` in the private config. Neither repository can see the other's half of the
  mapping — module paths are precisely what is kept out of public repos.
- **Nothing escapes the root.** Every written path is resolved through a containment check
  (`safeResolve` throws on escape), and the root is created if absent
  ([src/sync/paths.mjs L29–35](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/paths.mjs#L29-L35);
  [src/sync/course.mjs L36](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/course.mjs#L36)).

### What one sync writes inside the root

The set of expected files is one generator both `sync` and `verify` walk
([src/sync/expected.mjs](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/expected.mjs)):

| Path in the destination | What it is |
|---|---|
| `Course.md` | Course overview document, a pure function of the snapshot |
| `Last synced.md` | The **stamp** — run timestamp, the only file rewritten every run |
| `Announcements/YYYY-MM-DD <title>.md` | One document per announcement (`undated` when no date) |
| `NN <folder title>/` | Content-tree folders, `NN` = position+1, two digits |
| `NN <folder title>/_NTULearn.md` | A folder's own page, when it has one |
| `…/NN <item title>.md` | A content item's page (description, content, external link) |
| `…/NN <attachment filename>` | Attachments, byte-for-byte as NTULearn serves them |
| `…/NN <item title>.md` (stand-in) | An **uncopied item** — quiz, test, submission point — marked `<!-- ntulearn: nothing to copy -->` |

Writes are atomic (`.part-<pid>` then rename), so no partial file ever sits at a final name
([src/sync/files.mjs L12–22](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/files.mjs#L12-L22)).
The governing rules are the importer's ADRs: a sync **never deletes, never renames, and never
writes over anything it did not itself just fetch**
([ADR-0003](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0003-a-sync-never-deletes-from-a-destination.md));
it writes to where a file already is when only the number in its name moved, byte-comparing before
it leaves anything in place
([ADR-0009](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0009-a-sync-writes-to-where-a-file-already-is.md)).
This is MF-CURATION-002's stance already holding one level down: the mirror itself never silently
overwrites and never loses a withdrawn item.

## The state it keeps

Three things exist, none of them a manifest of the mirror:

1. **`.data/state.json`, in the importer's checkout — not in the destination.** Per course key it
   records `courseId`, `destination`, `syncedAt`, a `downloads` map keyed by resource URL (each
   record: a `fingerprint` of modified-date + size + URL, `relativePath`, `bytes`, **`sha256`**,
   and the served type), and flat id lists `contentIds`, `announcementIds`, `conversationIds`
   ([src/sync/course.mjs L90–107](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/course.mjs#L90-L107),
   [L163–213](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/course.mjs#L163-L213);
   [src/sync/state.mjs](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/state.mjs)).
   It is **overwritten in place each run** and documented as *"a cache and never a source of truth:
   losing it costs time and nothing else"*, with "manifest" on the avoid-list
   ([CONTEXT.md, *State*](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/CONTEXT.md)).
   The one read anything is allowed to make of it beyond skip-decisions is `renumber`'s use of the
   `sha256` to prove a file untouched
   ([src/cli.mjs L68–75](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/cli.mjs#L68-L75)).
2. **The stamp, `Last synced.md`.** It answers "did the sync run?", is written whatever the run
   found, and its ADR explicitly warns that a downstream consumer parsing it would make its shape a
   compatibility surface it is not today
   ([ADR-0008](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0008-when-the-run-happened-is-its-own-file.md),
   *Revisit when*). Stat it for freshness at most; do not parse it.
3. **The per-run stdout report.** A sync prints, per course, what that run did — `downloaded`,
   `skipped`, `markdownWritten`, `renumbered`, `failures`, and `newContent` / `newAnnouncements` /
   `newConversations` computed by diffing the current id lists against the previous state
   ([src/sync/course.mjs L109–123](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/course.mjs#L109-L123)).
   Nothing persists it; a durable run report is anticipated future work in the importer
   ([ADR-0008](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0008-when-the-run-happened-is-its-own-file.md),
   *Revisit when*), and the destination deliberately keeps no record of a run beyond the stamp.

### So: can an agent detect what landed since the last curation pass without diffing whole trees?

**Not from the importer.** The `new*` counts are per *sync run*, not per curation pass — a nightly
sync consumes its own baseline long before a weekly curation pass asks — and the state they diff
against is a cache whose loss is defined as costing nothing, sitting outside the module folder.

**But the question is answerable with one tree walk, not a diff of two trees**, because the
importer guarantees:

- **Additive.** Nothing curated ever disappears out from under a register entry
  ([ADR-0003](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0003-a-sync-never-deletes-from-a-destination.md)).
- **Untouched-unless-changed.** Documents are written only when their text differs
  (`writeIfChanged`), attachments only when fingerprint or bytes differ, and the write is a rename
  into place — so an unchanged file's mtime is never touched, and only the stamp moves on a
  no-change run
  ([src/sync/files.mjs L5–22](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/files.mjs#L5-L22);
  [ADR-0008](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0008-when-the-run-happened-is-its-own-file.md)).

The durable baseline must therefore be **this repository's curation register**
(MF-CURATION-001: stable source identity, source-relative path, checksum, decision per line).
"New arrivals" is: walk the mirror, subtract items whose identity the register already carries.
Two refinements the register design should take from the importer's internals:

- **Key on checksum and the name behind the number, not the numbered path.** The `NN ` prefix is
  the item's position at first write; an upstream insert renumbers every later *name* while nothing
  on disk moves, and `renumber` — manual, deliberate — later renames files whose `sha256` proves
  them untouched
  ([ADR-0009](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0009-a-sync-writes-to-where-a-file-already-is.md);
  [ADR-0010](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0010-renumbering-is-its-own-command-and-renames-only-what-it-can-prove.md)).
  A register `source_path` recorded verbatim goes stale on either event, and nothing corrects it.
  The importer's own resolver strips the `^\d+ ` prefix and matches within the expecting folder
  ([src/sync/paths.mjs L22–27](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/paths.mjs#L22-L27);
  [src/sync/numbering.mjs](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/numbering.mjs)) —
  the same tolerance a register lookup needs.
- **mtime > last-pass-timestamp is a sound cheap pre-filter**, an over-approximation to be
  confirmed against the register, not an authority — Drive sync behaviour across devices is the
  caveat, argued in [safe-google-drive-testing.md](safe-google-drive-testing.md).

`.data/state.json`'s `sha256` records can seed register checksums cheaply when present, but must be
treated as the cache they are: absent or regenerated whenever `.data/` was cleared.

## Naming and structure guarantees inside the mirror

What curation **can** assume:

- Fixed names at the root: `Course.md`, `Last synced.md`, `Announcements/`
  ([src/sync/expected.mjs L12–17](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/expected.mjs#L12-L17);
  [src/sync/course.mjs L15](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/course.mjs#L15)).
- Deterministic sanitisation: NFKC, reserved and control characters to `_`, whitespace collapsed,
  leading dots stripped, `untitled` fallback
  ([src/sync/paths.mjs L7–16](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/paths.mjs#L7-L16)).
  Names are otherwise NTULearn's own titles, which is why MF-IMPORTER-001 exempts them from the
  contract's naming rules.
- A folder's own page is always `_NTULearn.md`; an attachment keeps NTULearn's filename
  (`fileName`/`linkName`/`displayName`, falling back to `<item title>.bin`)
  ([src/ntulearn/content.mjs L81–85](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/ntulearn/content.mjs#L81-L85)).
- An item with nothing to copy still leaves a stand-in `.md` carrying the machine-readable mark
  `<!-- ntulearn: nothing to copy -->` — an automatic *source-only* classification candidate
  ([src/sync/markdown.mjs L104–121](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/markdown.mjs#L104-L121)).
- `.md` files are importer-authored *documents about* the course; attachments are the course's own
  files. The distinction is the importer's own
  ([CONTEXT.md, *Document*](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/CONTEXT.md)),
  and it is the curation-relevant one: attachments are the primary curation candidates.

What curation **must not** assume:

- **The number prefix is current.** `ls` shows the order files arrived in, not NTULearn's order
  today ([ADR-0009](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0009-a-sync-writes-to-where-a-file-already-is.md),
  Consequences).
- **Presence means the item is still on NTULearn.** The mirror is a growing superset; withdrawn
  items stay ([ADR-0003](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/docs/adr/0003-a-sync-never-deletes-from-a-destination.md)).
- **One item, one file.** When bytes changed under a moved number, the run writes at today's number
  *beside* the older file, so near-duplicates are a designed possibility.
- **Everything in the root is importer-written.** The importer tolerates — expects — the Owner's
  own annotations inside destinations, and MF-OPEN-001 leaves importer-root interiors outside
  structural enforcement. A crash can also leave `*.part-<pid>` litter, which curation should skip.
- **`complete: true` means the copy is the course.** `verify` counts files a sync would write,
  present at a path, relative to one reading of the course, and prints what that does not cover on
  every run ([README.md](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/README.md),
  "What `complete: true` does not cover";
  [src/sync/verify.mjs L9–17](https://github.com/Jerome-Group/ntulearn/blob/5ef5254f03878b887be48e7e9682e3c1759f83bd/src/sync/verify.mjs#L9-L17)).

## What this settles for the waiting decisions

- The curation flow gets no arrival feed from the importer and should not wait for one: the
  register-join over one mirror walk (checksum + unnumbered name, mtime pre-filter) is the design
  that works with the importer as it is.
- The daily routine can read freshness from the stamp's existence and mtime, and completeness from
  `verify`'s exit code — both are stable surfaces; the stamp's *text* and `.data/state.json` are
  not.
- If per-run arrival records in the destination ever become worth their cost, that is a change to
  ntulearn (ADR-0007/0008 *Revisit when* both anticipate it), proposed there — not something to
  reconstruct here from a cache the importer is free to throw away.
