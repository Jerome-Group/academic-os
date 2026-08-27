import { openRunJournal, type RunJournal } from "../mounted/run-journal.js";

// What a pass appending to a Curation register records around every write. Both curation passes
// append lines to the same file for the same reason, so they record the same three moments: what
// the run intends, that it landed, or why it refused.
export interface CurationRegisterJournalSubject {
  module: string;
  semester: string;
  path: string;
}

type CurationRegisterJournalBody =
  | { type: "intent"; appended: number; from: string; to: string }
  | { type: "result"; outcome: "appended" }
  | { type: "refused"; evidence: string };

export type CurationRegisterJournalEntry = CurationRegisterJournalSubject &
  CurationRegisterJournalBody;

export type CurationRegisterJournal = RunJournal<CurationRegisterJournalEntry>;

// The `kind` is the directory a run's journal lands in under `stateRoot`, and it is per pass: a
// reader looking for what corrected a register should not have to filter out what migrated one.
export async function openCurationRegisterJournal(input: {
  stateRoot: string;
  kind: "curation-identity" | "curation-rederivation";
}): Promise<CurationRegisterJournal> {
  return await openRunJournal<CurationRegisterJournalEntry>(input);
}
