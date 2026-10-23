import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";

import type {
  CalendarPromotionJournal,
  CalendarPromotionRecord,
} from "./types.js";

export function createFileCalendarPromotionJournal(
  stateRoot: string,
): CalendarPromotionJournal {
  const target = join(stateRoot, "calendar", "promotions.jsonl");
  return {
    find: async (proposalId) =>
      (await readRecords(target)).find(
        (record) => record.proposalId === proposalId,
      ),
    appendOnce: async (record) => {
      const result = await withJournalMutationOwner(
        { stateRoot, journalPath: target },
        async (canonicalTarget) => {
          if (
            (await readRecords(canonicalTarget)).some(
              ({ proposalId }) => proposalId === record.proposalId,
            )
          )
            return false;
          await mkdir(dirname(canonicalTarget), {
            recursive: true,
            mode: 0o700,
          });
          const file = await open(canonicalTarget, "a", 0o600);
          try {
            await file.writeFile(`${JSON.stringify(record)}\n`);
            await file.sync();
          } finally {
            await file.close();
          }
          const directory = await open(dirname(canonicalTarget), "r");
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
          return true;
        },
      );
      if (result.kind === "refused") throw new Error(result.evidence);
      return result.value;
    },
  };
}

async function readRecords(target: string): Promise<CalendarPromotionRecord[]> {
  try {
    return (await readFile(target, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CalendarPromotionRecord);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}
