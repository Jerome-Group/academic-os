import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  RepairExecutionJournalStore,
  RepairJournalEvent,
} from "./execute-repair.js";
import { RepairPlanError } from "./plan-repair.js";

export function createFileRepairJournalStore(
  stateRoot: string,
): RepairExecutionJournalStore {
  return {
    read: async (changeSetId) =>
      await readJournal(journalPath(stateRoot, changeSetId)),
    append: async (event) => {
      const path = journalPath(stateRoot, event.changeSetId);
      const existing = await readJournal(path);
      if (event.sequence !== existing.length) {
        throw new RepairPlanError(
          "Repair journal sequence is not append-only.",
        );
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const file = await open(path, event.sequence === 0 ? "wx" : "a", 0o600);
      try {
        await file.writeFile(`${JSON.stringify(event)}\n`, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      if (event.sequence === 0) await syncDirectory(dirname(path));
    },
  };
}

async function readJournal(path: string): Promise<RepairJournalEvent[]> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw new RepairPlanError("Repair journal cannot be read.");
  }
  const events: RepairJournalEvent[] = [];
  for (const line of source.split("\n").filter(Boolean)) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new RepairPlanError("Repair journal contains invalid JSON.");
    }
    if (!isRepairJournalEvent(value)) {
      throw new RepairPlanError("Repair journal contains an invalid event.");
    }
    events.push(value);
  }
  if (events.some((event, index) => event.sequence !== index)) {
    throw new RepairPlanError("Repair journal contains an ambiguous sequence.");
  }
  return events;
}

function journalPath(stateRoot: string, changeSetId: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(changeSetId)) {
    throw new RepairPlanError(
      "Repair change-set ID is unsafe for journal storage.",
    );
  }
  return join(stateRoot, "journals", "repairs", `${changeSetId}.jsonl`);
}

function isRepairJournalEvent(value: unknown): value is RepairJournalEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  return (
    event.schemaVersion === 1 &&
    Number.isInteger(event.sequence) &&
    typeof event.recordedAt === "string" &&
    typeof event.changeSetId === "string" &&
    typeof event.planDigest === "string" &&
    [
      "started",
      "recovery-completed",
      "operation-started",
      "operation-completed",
      "verification-completed",
      "failure",
      "outcome",
    ].includes(String(event.type))
  );
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
