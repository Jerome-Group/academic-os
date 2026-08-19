# Safe Drive testing

The rules for tests and automation that can touch Google Drive module folders. Research and
primary-source evidence live in [`docs/research/safe-google-drive-testing.md`](../research/safe-google-drive-testing.md);
this file is the binding procedure.

## Choose the tier

- **Contract tests** create synthetic trees in an operating-system temporary directory outside
  every Drive mount.
- **Live acceptance audits** inspect real module folders read-only.
- **Drive integration tests** are opt-in and write only inside the configured test-root Drive ID.
- **Mounted writes** change the Owner's real content through Drive for Desktop rather than the
  API — seeding, the repair executor's staging and publication, the shelf migration's renames.
  They are the one tier with no Drive ID to hold, and *Prove a mounted write* below is their rule.

Real module folders are never integration-test fixtures. A test run is correctly scoped when its
tier is explicit and every possible write resolves inside that tier's disposable root.

## Fail closed before a Drive integration run

Start no run until all conditions hold:

1. The explicit integration-test flag is present.
2. The configured root ID resolves to the expected folder and installation-specific canary.
3. The test root is outside every semester, module and recovery root.
4. The credentials and target capabilities permit only the required operations.
5. A complete paginated inventory succeeds without incomplete-search results.
6. The independent reconciler proves no unresolved artifact remains from an earlier run.

Create one run folder beneath the test root. Mark it and every descendant with the same random run
ID, and journal intent and result around every Drive call. Treat batched calls as independent
operations that may partially succeed, never as a transaction.

## Clean exact owned artifacts

Synthetic test artifacts are the only permanent-deletion exception. Cleanup must:

1. Re-list descendants and all items marked with the run ID.
2. Require exact equality between that inventory and the run journal: every target was recorded as
   created by this run, and every recorded live artifact appears in the inventory.
3. Refuse cleanup if provenance is missing, an unmarked descendant exists, or a marked item sits
   outside the run root.
4. Delete exact recorded IDs deepest-first and the run folder last.
5. Never empty Drive Trash.
6. Re-run both searches through every page and prove that no run artifact remains.

A failed cleanup fails the test and preserves its journal. The next invocation reconciles that
exact run before creating anything. Cleanup is complete only when both the run-folder lookup and
the run-marker lookup return zero items.

## Protect real modules

An audit has no write-capable dependency. The repair executor accepts only a versioned, approved
plan whose IDs and preconditions still match a fresh observation. Before any real repair, create
and verify both an ID-mapped Drive copy and a byte snapshot on separate storage. Module contents
move to the recovery vault rather than being permanently deleted; Drive Trash is not a recovery
design. A transition is the lighter path beside repair: it writes the control files this repository
authors and moves documents, reads academic contents and leaves them where they are, and so binds
neither of those recoveries — its writes prove themselves under *Prove a mounted write* instead.

Through the API, paths are human evidence, not mutation identity: inventory and mutation use Drive
IDs, request every page, reject incomplete results, and treat absent checksums or revisions as
unavailable rather than equal.

## Prove a mounted write before it happens

Drive for Desktop hands the seeder, the repair staging and the shelf renamer a filesystem and no ID
surface, so the identity above is one none of them can hold. Content stands in its place: a Drive
ID names the container a file arrived in, and a sha256 names the file. A mounted write that needs
to know it has the right target holds a checksum and reads it again.

Each write proves all four before it happens:

1. **Containment.** The target's `realpath` resolves inside a configured root, so the check is
   against where the write lands rather than where it was asked for.
2. **A target taken deliberately.** A new file takes its name exclusively; a file the caller owns
   is replaced through a temporary and one rename, so no reader meets it half-written; a name
   anything else already holds refuses the write. Overwriting on the mount destroys the file
   without passing it through Drive Trash.
3. **Materialization.** Every target and source is real bytes rather than a dataless placeholder.
   A Drive file that has not been downloaded appears in the listing and reads as empty, so a pass
   that skips this reads nothing and reports it as content.
4. **A fresh reading.** Whatever the write was planned against — a checksum, a listing, a target
   state — is read again immediately before the write, and a disagreement refuses the run rather
   than the one operation. A plan built against a tree that has since moved is a plan about a
   different tree.

The journal obligation above holds here and records paths: a mounted recovery has nothing else to
read.
