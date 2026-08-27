import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";

interface RunJournalEnvelope {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  recordedAt: string;
}

export interface RunJournal<Entry> {
  path: string;
  append(entry: Entry): Promise<void>;
}

// The journal every mounted pass owes its writes, under `docs/agents/safe-drive-testing.md`: a
// mounted recovery has no Drive ID to read, so this file and the paths in it are what say how far a
// run got. Each pass declares its own entry shape and shares the envelope, the run identifier and
// the durable append — one copy, so a change to how a run is recorded reaches every pass at once.
//
// Opened only once a run has something to write, so a pass with nothing to do leaves no file behind.
export async function openRunJournal<Entry>(input: {
  stateRoot: string;
  kind: string;
}): Promise<RunJournal<Entry>> {
  const runId = randomUUID();
  const path = join(input.stateRoot, "journals", input.kind, `${runId}.jsonl`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let sequence = 0;
  return {
    path,
    async append(entry) {
      const envelope: RunJournalEnvelope = {
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
