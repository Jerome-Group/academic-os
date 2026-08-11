# Safe testing around Google Drive module folders

## Conclusion

Do not run destructive tests inside a real module. Use three separate tiers:

1. **Local contract tests** build arbitrary correct and incorrect trees in a fresh operating-system
   temporary directory outside the Drive mount.
2. **Live acceptance audits** inspect real module folders read-only.
3. **Drive integration tests** are opt-in and may write only beneath one dedicated Drive test-root
   ID. Every created item is tagged and journalled; the run proves cleanup before succeeding.

This is stricter than relying on a test teardown. Node's global teardown is not called when global
setup throws, although per-test `afterEach` hooks do run after a failed test. A separate reconciler
is therefore required to find leftovers from interrupted processes
([Node test runner](https://nodejs.org/api/test.html#global-setup-and-teardown),
[Node test hooks](https://nodejs.org/api/test.html#aftereachfn-options)).

## Why the Drive mount is a production surface

Drive for desktop makes local changes propagate everywhere. Moving a synced item to Trash does so
everywhere, and Google explicitly says files must finish syncing before folders are moved or
deleted. Streamed files can also be unavailable when Drive for desktop is not running; mirrored
files may hold unsynced changes locally
([streaming and mirroring](https://support.google.com/drive/answer/13401938?hl=en),
[deletion from Drive for desktop](https://support.google.com/drive/answer/2375102?co=GENIE.Platform%3DDesktop&hl=en),
[advanced Drive for desktop guide](https://support.google.com/drive/answer/16631477?hl=en)).

Google documents a human-facing **Sync status** view, not a supported programmatic completion
barrier for local filesystem writes. Therefore:

- normal tests never use the mount;
- real-module audits open files read-only and never perform test cleanup there;
- integration writes use the Drive API and verify the API state directly;
- any future module mutation through the mount requires a human sync-status gate plus before/after
  verification. Apparent local completion alone is not proof that the cloud accepted the change.

## Identity and inventory rules

A Drive filename is not an identity: `name` is not necessarily unique within a folder. Drive
operations address a file by its opaque ID, which remains stable through name changes; a file
currently has one parent folder ID. Persist IDs for the managed roots, integration-test root,
recovery vault and every observed item. Paths remain useful evidence for humans but must never
select a mutation target
([files and folders overview](https://developers.google.com/workspace/drive/api/guides/about-files),
[Drive `File` resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)).

Inventory must:

- query children by exact parent ID, not just by name;
- request every page until `nextPageToken` is absent;
- reject `incompleteSearch: true` and narrow the corpus instead of treating the result as complete;
- request fields explicitly, because `files.list` returns only a small default set;
- record shortcuts as shortcuts, including `shortcutDetails.targetId`, and never follow their
  targets during traversal or cleanup.

These requirements follow the API's pagination and incomplete-search behaviour and its explicit
shortcut metadata
([search and pagination](https://developers.google.com/workspace/drive/api/guides/search-files),
[`files.list`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list),
[Drive shortcuts](https://developers.google.com/workspace/drive/api/guides/shortcuts)).

## Complete observations and change detection

Each audit observation should contain the complete tree of relative paths plus, where the source
provides them:

- `id`, `name`, `parents`, `mimeType`, `size`, `createdTime`, `modifiedTime`, `version` and
  `trashed`;
- `md5Checksum`, `sha1Checksum`, `sha256Checksum` and `headRevisionId`;
- shortcut target metadata;
- contract/profile versions and deterministic findings.

Checksums and head revision IDs are unavailable for some types: Drive checksum fields cover
stored binary content, not Google Docs Editors files or shortcuts. Absence must be recorded as
`unavailable`, never interpreted as equality
([Drive `File` resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)).

The Drive changes feed is suitable for incremental weekly work: obtain and save a start page token,
consume changes in chronological order through every page, include removals, and save
`newStartPageToken` only after the last page is durably processed. It is not a replacement for the
baseline full inventory or periodic full reconciliation. A `removed` change can mean deletion or
loss of access, so it is evidence of disappearance, not by itself evidence of deletion
([retrieve changes](https://developers.google.com/workspace/drive/api/guides/manage-changes),
[Drive `Change` resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes)).

## Opt-in Drive integration-test protocol

### Permanent test root

Create one visible, dedicated test root outside all semester and module roots. Store its exact ID
in gitignored local configuration. Put a canary in it containing a random, installation-specific
value. Never use `appDataFolder` for fixtures: it is hidden from users, cannot be shared or trashed,
and can be deleted when the app is uninstalled. It is suitable only for private app configuration
if that lifecycle is acceptable
([application data folder](https://developers.google.com/workspace/drive/api/guides/appdata)).

Every mutating run must fail closed unless all of these hold:

1. an explicit integration-test flag is present;
2. the fetched object at the configured ID is a folder with the expected canary and marker;
3. the root is not equal to, inside, or an ancestor of any configured semester/module/recovery
   root;
4. credentials have only the required scopes and the root exposes the required per-item
   capabilities;
5. a preflight inventory completes without pagination or incomplete-search errors;
6. the previous-run reconciler finds no unresolved leftovers.

### Per-run containment

Create one uniquely named run folder directly beneath the test root. Put an `appProperties` marker
and random run ID on the run folder and every descendant. Generate IDs before creation where
supported; a successful create followed by a retry using the same pre-generated ID returns
`409 Conflict` instead of creating a duplicate. Pre-generated IDs are not available for all
Google Workspace-file creation/conversion cases
([pre-generated IDs](https://developers.google.com/workspace/drive/api/guides/create-file)).

Write an append-only local journal before and after each API call. Record intended ID, parent ID,
operation, response and cleanup status. The marker closes the crash window where an item exists but
the local journal was not updated; the journal closes the opposite diagnostic gap.

Do not call a batch a transaction. Drive splits a batch into separate requests, may execute calls
in any order, and returns a status for each; partial success must be expected. Ordered dependencies
must use separate calls. Media upload/download is not supported in batches
([Drive batching](https://developers.google.com/workspace/drive/api/guides/performance#batch-requests)).
One-item operations therefore need explicit compensation and verification.

For uploads large enough that retry cost matters, use resumable upload; it resumes after a
communication failure. For small files that need metadata and content together, use multipart
upload so the run marker is attached at creation
([Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)).

### Cleanup with no junk left behind

To meet the user's “no test junk” requirement, the implementation should explicitly authorize
permanent deletion of **only synthetic test-owned items**. This is a narrow exception to module
repair policy; module content is never permanently deleted.

1. Re-list all run descendants by parent IDs and all items carrying the run marker.
2. Refuse cleanup if any descendant lacks the marker or if any marked item lies outside the run
   root.
3. Delete only exact recorded IDs, deepest first. Delete the run folder last.
4. Never call `emptyTrash`; it affects unrelated user items.
5. Re-run both searches and fetch every page. Success requires zero marked items and no run folder.
6. If cleanup or verification fails, fail the test and retain the journal. The independent
   reconciler repeats exact-ID cleanup on the next invocation before creating anything.

Deleting a Drive folder permanently deletes its owned descendants, so recursive folder deletion
must be the final guarded operation, never the first. Drive's `files.delete` bypasses Trash
([Drive delete method](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete),
[trash and delete guide](https://developers.google.com/workspace/drive/api/guides/delete)).

Normal local tests use `fs.mkdtemp` and remove only the returned exact directory. Do not point a
recursive cleanup at an environment-derived Drive path. Node also makes no atomicity guarantee for
`copyFile`, reinforcing that a copy must be verified before it is treated as a backup
([Node filesystem API](https://nodejs.org/api/fs.html#fspromisesmkdtempprefix-options),
[`copyFile` semantics](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode)).

## Permissions and credentials

Use separate credentials for read-only and write tests. Google recommends the narrowest scope:

- `drive.file` is non-sensitive and permits files created by or explicitly shared/opened with the
  app; it fits a dedicated integration root granted to the app;
- `drive.metadata.readonly` or `drive.readonly` can inspect broader existing Drive state but are
  restricted scopes;
- full `drive` access is unnecessary for integration fixtures and magnifies cleanup risk.

Keep refresh tokens out of the repository and in secure long-term storage
([Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)).
At runtime, also inspect item capabilities such as `canTrash`/`canDelete`; an OAuth scope does not
prove that the current user can perform an operation on a particular item
([Drive deletion capabilities](https://developers.google.com/workspace/drive/api/guides/delete#capabilities)).

## Backup and recovery for real module changes

Trash is not the recovery design. Drive for desktop propagates trashing, and Google permanently
deletes trashed files after 30 days or immediately when Trash is emptied
([Google Drive Trash retention](https://support.google.com/drive/answer/14933051?hl=en)).

Before an approved real repair:

1. take a fresh complete observation and refuse to proceed if it differs from the reviewed plan;
2. make an independent Drive copy of every affected file in a separate, unmonitored recovery
   vault; also download blobs and export Google Workspace files where possible;
3. verify downloaded bytes with a checksum where Drive supplies one, otherwise hash the downloaded
   or exported bytes locally and record the export format;
4. record source ID, original parent/path, source metadata, backup ID/path, checksum, action and
   change-set ID;
5. prefer reversible moves/renames over replacement; never use `files.delete` or `emptyTrash` on
   module content.

Drive cannot copy a folder as one operation; it requires constructing a destination and copying
children. Copies can have different ownership or permissions and do not necessarily reproduce the
source's sharing settings. Google Workspace export output is limited to 10 MB, while blob
revision retention is limited unless a revision is marked `Keep Forever`. Therefore a verified
manifest plus content copies is required; neither a folder copy nor revision history alone is a
rollback guarantee
([copy limits](https://developers.google.com/workspace/drive/api/guides/create-file#copy_an_existing_file),
[download and export](https://developers.google.com/workspace/drive/api/guides/manage-downloads),
[revision retention](https://developers.google.com/workspace/drive/api/guides/change-overview)).

## Required architecture boundary

The deterministic conformance engine accepts an abstract tree and produces findings and proposed
operations. It must have no Drive-writing capability. Adapters are separate:

- local fixture adapter: arbitrary trees under an OS temporary directory;
- mounted-folder adapter: read-only inventory of real modules;
- Drive API read adapter: ID-based observation and change-feed support;
- Drive API test adapter: compile-time/runtime restricted to the configured test-root ID;
- future repair executor: separately invoked, plan-bound, approval-bound and recovery-vault-bound.

An LLM may classify evidence, ask questions and propose a plan. It must not supply raw paths or IDs
directly to a mutator. The executor accepts only a validated, versioned plan whose targets were
resolved by the deterministic inventory and whose preconditions still match.
