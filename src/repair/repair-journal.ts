import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";

import type {
  RepairExecutionJournalStore,
  RepairJournalEvent,
} from "./execute-repair.js";
import { RepairPlanError } from "./plan-repair.js";

export function createFileRepairJournalStore(
  stateRoot: string,
): RepairExecutionJournalStore {
  return {
    inspect: async (changeSetId) =>
      await readJournal(journalPath(stateRoot, changeSetId)),
    mutate: async (changeSetId, run) =>
      await withJournalMutationOwner(
        { stateRoot, journalPath: mutationJournalPath(stateRoot, changeSetId) },
        async (path) => {
          let active = true;
          const pending: Array<{
            promise: Promise<unknown>;
            settled: boolean;
          }> = [];
          function admit<T>(operation: () => Promise<T>): Promise<T> {
            if (!active)
              return Promise.reject(
                new RepairPlanError(
                  "Repair journal mutation session has expired.",
                ),
              );
            const promise = operation();
            const tracked = { promise, settled: false };
            pending.push(tracked);
            void promise.then(
              () => {
                tracked.settled = true;
              },
              () => {
                tracked.settled = true;
              },
            );
            return promise;
          }
          let outcome:
            | { kind: "returned"; value: Awaited<ReturnType<typeof run>> }
            | { kind: "threw"; error: unknown };
          try {
            const value = await run({
              read: () => admit(async () => await readJournal(path)),
              append: (event) =>
                admit(async () => {
                  if (event.changeSetId !== changeSetId)
                    throw new RepairPlanError(
                      "Repair journal event belongs to another change set.",
                    );
                  await appendJournal(path, event);
                }),
            });
            outcome = { kind: "returned", value };
          } catch (error) {
            outcome = { kind: "threw", error };
          } finally {
            active = false;
          }
          const settled = await Promise.allSettled(
            pending
              .filter(({ settled }) => !settled)
              .map(({ promise }) => promise),
          );
          const failed = settled.find((result) => result.status === "rejected");
          if (outcome.kind === "threw") throw outcome.error;
          if (failed?.status === "rejected") throw failed.reason;
          return outcome.value;
        },
      ),
  };
}

async function appendJournal(
  path: string,
  event: RepairJournalEvent,
): Promise<void> {
  const existing = await readJournal(path);
  if (event.sequence !== existing.length) {
    throw new RepairPlanError("Repair journal sequence is not append-only.");
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

function mutationJournalPath(stateRoot: string, changeSetId: string): string {
  if (changeSetId !== changeSetId.toLowerCase())
    throw new RepairPlanError(
      "Repair mutation requires a lowercase change-set ID. Inspect and reconcile the existing journal before changing a historical ID; no rename or approval rewrite was performed.",
    );
  return journalPath(stateRoot, changeSetId);
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
    typeof event.type === "string" &&
    [
      "started",
      "recovery-completed",
      "operation-started",
      "operation-completed",
      "verification-completed",
      "failure",
      "outcome",
    ].includes(event.type)
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
