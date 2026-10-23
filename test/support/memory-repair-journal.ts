import type {
  RepairExecutionJournalStore,
  RepairJournalEvent,
} from "../../src/repair/index.js";

export function memoryRepairJournal(
  events: RepairJournalEvent[],
  append: (event: RepairJournalEvent) => Promise<void> = async (event) => {
    events.push(event);
  },
): RepairExecutionJournalStore {
  const owners = new Set<string>();
  return {
    inspect: async () => [...events],
    mutate: async (changeSetId, run) => {
      if (owners.has(changeSetId))
        return {
          kind: "refused",
          reason: "busy",
          evidence:
            "Another invocation owns this journal; retry after it finishes.",
        };
      owners.add(changeSetId);
      let active = true;
      const pending: Array<{ promise: Promise<unknown>; settled: boolean }> =
        [];
      function admit<T>(operation: () => Promise<T>): Promise<T> {
        if (!active)
          return Promise.reject(
            new Error("Repair journal mutation session has expired."),
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
          read: () => admit(async () => [...events]),
          append: (event) =>
            admit(async () => {
              if (event.changeSetId !== changeSetId)
                throw new Error(
                  "Repair journal event belongs to another change set.",
                );
              await append(event);
            }),
        });
        outcome = { kind: "returned", value };
      } catch (error) {
        outcome = { kind: "threw", error };
      } finally {
        active = false;
      }
      try {
        const settled = await Promise.allSettled(
          pending
            .filter(({ settled }) => !settled)
            .map(({ promise }) => promise),
        );
        const failed = settled.find((result) => result.status === "rejected");
        if (outcome.kind === "threw") throw outcome.error;
        if (failed?.status === "rejected") throw failed.reason;
        return { kind: "owned", value: outcome.value };
      } finally {
        owners.delete(changeSetId);
      }
    },
  };
}
