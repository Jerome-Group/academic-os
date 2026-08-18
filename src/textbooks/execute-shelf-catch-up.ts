import type {
  ShelfCatchUpPlan,
  ShelfCatchUpReport,
  ShelfIndexStore,
} from "./types.js";

// A parked book stops itself and nothing else: the clean books of the same run are appended, and
// the parks travel to the Owner in the report.
export async function executeShelfCatchUp(input: {
  plan: ShelfCatchUpPlan;
  store: ShelfIndexStore;
  mode: "preview" | "apply";
}): Promise<ShelfCatchUpReport> {
  const { appends, parked, counts } = input.plan;
  const written = input.mode === "apply" && appends.length > 0;
  if (written) await input.store.append(appends);
  return {
    schemaVersion: 1,
    command: "textbooks catch-up",
    outcome:
      parked.length > 0
        ? "requires-decision"
        : input.mode === "apply"
          ? "caught-up"
          : "previewed",
    index: written ? "written" : "unchanged",
    counts: {
      books: counts.books,
      indexed: counts.indexed,
      appends: appends.length,
      parked: parked.length,
    },
    appends: appends.map(({ key, entry }) => ({ key, file: entry.file })),
    parked,
  };
}
