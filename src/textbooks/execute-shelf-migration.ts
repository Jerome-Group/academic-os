import type {
  ShelfIndexStore,
  ShelfMigrationJournal,
  ShelfMigrationPlan,
  ShelfMigrationReport,
  ShelfRenamer,
} from "./types.js";

// Renames first and the index last, because the index records final filenames. Every rename is
// journalled around the call rather than after the run, so a run interrupted between two books
// leaves the record of exactly which ones moved.
export async function executeShelfMigration(input: {
  plan: ShelfMigrationPlan;
  renamer: ShelfRenamer;
  store: ShelfIndexStore;
  journal: ShelfMigrationJournal;
  mode: "preview" | "apply";
}): Promise<ShelfMigrationReport> {
  const { renames, appends, blockers } = input.plan;
  if (blockers.length > 0) {
    return report(input.plan, "requires-decision", "not-written");
  }
  if (input.mode === "preview") {
    return report(input.plan, "previewed", "not-written");
  }
  await input.journal.record({
    type: "started",
    renames,
    keys: appends.map(({ key }) => key),
  });
  try {
    for (const rename of renames) {
      await input.renamer.rename(rename);
      await input.journal.record({ type: "renamed", ...rename });
    }
    await input.store.append(appends);
  } catch (error) {
    await input.journal.record({
      type: "failed",
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await input.journal.record({
    type: "indexed",
    keys: appends.map(({ key }) => key),
  });
  return report(
    input.plan,
    "migrated",
    appends.length > 0 ? "written" : "not-written",
  );
}

function report(
  plan: ShelfMigrationPlan,
  outcome: ShelfMigrationReport["outcome"],
  index: ShelfMigrationReport["index"],
): ShelfMigrationReport {
  return {
    schemaVersion: 1,
    command: "textbooks migrate",
    outcome,
    index,
    counts: {
      books: plan.counts.books,
      renames: plan.renames.length,
      appends: plan.appends.length,
      blockers: plan.blockers.length,
    },
    renames: plan.renames,
    appends: plan.appends.map(({ key, entry }) => ({ key, file: entry.file })),
    blockers: plan.blockers,
  };
}
