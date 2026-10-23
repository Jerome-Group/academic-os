import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { applyShelfRows } from "./apply-shelf-rows.js";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import { createFileShelfReader } from "./file-shelf-reader.js";
import { readShelfIndexDocument } from "./file-shelf-index-store.js";
import { planShelfCatchUp } from "./plan-shelf-catch-up.js";
import { planShelfMigration } from "./plan-shelf-migration.js";
import { observeShelfRun } from "./reconcile-shelf-run.js";
import { identity, requireShelfRoot } from "./shelf-file-observation.js";
import {
  appendShelfRun,
  prepareShelfJournal,
  readShelfRuns,
  settledRun,
} from "./shelf-run-journal.js";
import type {
  FileShelf,
  ShelfApprovedRow,
  ShelfCatchUpReport,
  ShelfMigrationReport,
  ShelfMutationEvidence,
  ShelfReview,
} from "./types.js";

export async function openFileShelf(input: {
  shelfRoot: string;
  stateRoot: string;
}): Promise<FileShelf> {
  const shelfRoot = await realpath(input.shelfRoot);
  const stateRoot = await realpath(input.stateRoot);
  if (!(await lstat(stateRoot)).isDirectory())
    throw new Error("Shelf private state root must be a directory.");
  const inside = relative(shelfRoot, stateRoot);
  if (
    inside === "" ||
    (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
  )
    throw new Error("Shelf private state must be outside the Shelf.");
  const rootStat = await lstat(shelfRoot, { bigint: true });
  if (!rootStat.isDirectory())
    throw new Error("Shelf root is not an ordinary directory.");
  const expectedRoot = identity(rootStat);
  const journalPath = join(
    stateRoot,
    "journals",
    "textbooks",
    `${createHash("sha256").update(shelfRoot).digest("hex")}.jsonl`,
  );
  const reader = createFileShelfReader(shelfRoot);

  async function run(
    mode: "apply" | "preview",
    operation: "migrate" | "catch-up",
    review?: ShelfReview,
  ): Promise<ShelfMigrationReport | ShelfCatchUpReport> {
    const plan = async () => {
      await requireShelfRoot(shelfRoot, expectedRoot);
      const current = await readShelfIndexDocument(shelfRoot);
      if (operation === "migrate") {
        if (review === undefined)
          throw new Error("Migration requires a settled review.");
        const migration = await planShelfMigration({
          reader,
          index: current.index,
          review,
        });
        const report: ShelfMigrationReport = {
          schemaVersion: 1,
          command: "textbooks migrate",
          outcome:
            migration.blockers.length > 0
              ? "requires-decision"
              : mode === "preview"
                ? "previewed"
                : "migrated",
          index: "not-written",
          counts: {
            ...migration.counts,
            renames: migration.renames.length,
            appends: migration.appends.length,
            blockers: migration.blockers.length,
          },
          renames: migration.renames,
          appends: migration.appends.map(({ key, entry }) => ({
            key,
            file: entry.file,
          })),
          blockers: migration.blockers,
        };
        return {
          report,
          rows: migration.rows,
          listing: migration.listing,
          current,
          blocked: migration.blockers.length > 0,
        };
      }
      const catchUp = await planShelfCatchUp({ reader, index: current.index });
      const report: ShelfCatchUpReport = {
        schemaVersion: 1,
        command: "textbooks catch-up",
        outcome:
          catchUp.parked.length > 0
            ? "requires-decision"
            : mode === "preview"
              ? "previewed"
              : "caught-up",
        index: "not-written",
        counts: {
          ...catchUp.counts,
          appends: catchUp.appends.length,
          parked: catchUp.parked.length,
        },
        appends: catchUp.appends.map(({ key, entry }) => ({
          key,
          file: entry.file,
        })),
        parked: catchUp.parked,
      };
      return {
        report,
        rows: catchUp.appends.map(
          (append): ShelfApprovedRow => ({
            kind: "append",
            source: append.entry.file,
            ...append,
          }),
        ),
        listing: catchUp.listing,
        current,
        blocked: false,
      };
    };
    if (mode === "preview") return (await plan()).report;
    await prepareShelfJournal(stateRoot, journalPath);
    const owned = await withJournalMutationOwner(
      { stateRoot, journalPath },
      async (journal) => {
        for (const previous of (await readShelfRuns(journal)).values()) {
          if (settledRun(previous)) continue;
          const observation = await observeShelfRun(previous, journal);
          if (observation.state === "partial")
            return failureReport(
              operation,
              "refused",
              journal,
              ["An unresolved Shelf run fences every new apply."],
              observation,
            );
          await appendShelfRun(journal, {
            ...previous,
            phase: "acknowledged",
            evidence: observation.evidence,
          });
        }
        const planned = await plan();
        if (planned.blocked || planned.report.counts.appends === 0)
          return planned.report;
        const result = await applyShelfRows({
          shelfRoot,
          stateRoot,
          root: expectedRoot,
          journal,
          operation,
          rows: planned.rows,
          listing: planned.listing,
          current: planned.current,
        });
        if (result.outcome === "complete")
          return {
            ...planned.report,
            index: result.index,
            mutation: result.evidence,
          };
        return {
          ...planned.report,
          outcome: result.outcome,
          index: result.index,
          mutation: result.evidence,
        };
      },
    );
    if (owned.kind === "refused")
      return failureReport(operation, "refused", journalPath, [owned.evidence]);
    return owned.value;
  }

  return {
    async migrate(request) {
      const report = await run(request.mode, "migrate", request.review);
      if (report.command !== "textbooks migrate")
        throw new Error("Unexpected Shelf migration report.");
      return report;
    },
    async catchUp(request) {
      const report = await run(request.mode, "catch-up");
      if (report.command !== "textbooks catch-up")
        throw new Error("Unexpected Shelf catch-up report.");
      return report;
    },
    async reconcile({ runId }) {
      const run = (await readShelfRuns(journalPath)).get(runId);
      if (run === undefined || run.shelfRoot !== shelfRoot)
        throw new Error(`No exact Shelf run ${runId} in ${journalPath}.`);
      return await observeShelfRun(run, journalPath);
    },
  };
}

function failureReport(
  operation: "migrate" | "catch-up",
  outcome: "refused",
  journal: string,
  reasons: string[],
  recovery?: ShelfMutationEvidence["recovery"],
): ShelfMigrationReport | ShelfCatchUpReport {
  const mutation: ShelfMutationEvidence = {
    journal,
    captures: [],
    renamed: [],
    reasons,
    ...(recovery === undefined ? {} : { recovery }),
  };
  return operation === "migrate"
    ? {
        schemaVersion: 1,
        command: "textbooks migrate",
        outcome,
        index: "not-written",
        mutation,
        counts: { books: 0, renames: 0, appends: 0, blockers: 0 },
        renames: [],
        appends: [],
        blockers: reasons,
      }
    : {
        schemaVersion: 1,
        command: "textbooks catch-up",
        outcome,
        index: "not-written",
        mutation,
        counts: { books: 0, indexed: 0, appends: 0, parked: 0 },
        appends: [],
        parked: [],
      };
}
