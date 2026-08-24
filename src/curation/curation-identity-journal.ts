import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";

interface CurationIdentityJournalEnvelope {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  recordedAt: string;
}

export interface CurationIdentityJournalSubject {
  module: string;
  semester: string;
  path: string;
}

type CurationIdentityJournalBody =
  | { type: "intent"; appended: number; from: string; to: string }
  | { type: "result"; outcome: "appended" }
  | { type: "refused"; evidence: string };

export type CurationIdentityJournalEntry = CurationIdentityJournalSubject &
  CurationIdentityJournalBody;

export interface CurationIdentityJournal {
  path: string;
  append(entry: CurationIdentityJournalEntry): Promise<void>;
}

// Opened only once a run has something to write, so a cohort already on contract-v4 identity leaves
// no file behind. A mounted recovery reads this and the paths in it, having no Drive ID to read.
export async function openCurationIdentityJournal(
  stateRoot: string,
): Promise<CurationIdentityJournal> {
  const runId = randomUUID();
  const path = join(
    stateRoot,
    "journals",
    "curation-identity",
    `${runId}.jsonl`,
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let sequence = 0;
  return {
    path,
    async append(entry) {
      const envelope: CurationIdentityJournalEnvelope = {
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
