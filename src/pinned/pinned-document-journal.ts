import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";

interface PinnedDocumentJournalEnvelope {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  recordedAt: string;
}

export interface PinnedDocumentJournalSubject {
  module: string;
  semester: string;
  path: string;
}

type PinnedDocumentJournalBody =
  | {
      type: "intent";
      state: "stale" | "missing";
      from: string | null;
      to: string;
    }
  | { type: "result"; outcome: "rewritten" }
  | { type: "refused"; evidence: string };

export type PinnedDocumentJournalEntry = PinnedDocumentJournalSubject &
  PinnedDocumentJournalBody;

export type PinnedDocumentJournalEvent = PinnedDocumentJournalEnvelope &
  PinnedDocumentJournalEntry;

export interface PinnedDocumentJournal {
  path: string;
  append(entry: PinnedDocumentJournalEntry): Promise<void>;
}

// Opened only once a run has something to write, so a cohort that was already current leaves no
// file behind. A mounted recovery reads this and the paths in it, having no Drive ID to read.
export async function openPinnedDocumentJournal(
  stateRoot: string,
): Promise<PinnedDocumentJournal> {
  const runId = randomUUID();
  const path = join(
    stateRoot,
    "journals",
    "pinned-documents",
    `${runId}.jsonl`,
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let sequence = 0;
  return {
    path,
    async append(entry) {
      const envelope: PinnedDocumentJournalEnvelope = {
        schemaVersion: 1,
        runId,
        sequence,
        recordedAt: new Date().toISOString(),
      };
      sequence += 1;
      const file = await open(path, "a", 0o600);
      try {
        await file.writeFile(
          `${JSON.stringify({ ...envelope, ...entry })}\n`,
          "utf8",
        );
        await file.sync();
      } finally {
        await file.close();
      }
    },
  };
}
