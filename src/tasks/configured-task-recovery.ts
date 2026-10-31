import { fileURLToPath } from "node:url";
import { resolveStateRoot } from "../config/index.js";
import { createFileTaskRecoveryStore } from "./file-task-recovery-store.js";
import { createFileTaskLifecycleStore } from "./file-task-lifecycle-store.js";
import { readTaskCreationHistory } from "./task-operation-journal-file.js";
import type { TaskRecoveryStore } from "./task-recovery-types.js";

export function configuredTaskRecoveryStore(config: {
  stateRoot: string;
  driveMount: string;
}): TaskRecoveryStore {
  const openStore = async () =>
    createFileTaskRecoveryStore({
      stateRoot: await resolveStateRoot(config),
      excludedRoots: [
        config.driveMount,
        fileURLToPath(new URL("../../../", import.meta.url)),
      ],
    });
  return {
    retain: async (id, reference) => (await openStore()).retain(id, reference),
    release: async (id, reference) =>
      (await openStore()).release(id, reference),
    read: async (id) => (await openStore()).read(id),
    list: async (target) => (await openStore()).list(target),
    withSnapshot: async (id, run) => (await openStore()).withSnapshot(id, run),
    capture: async (input) => {
      const stateRoot = await resolveStateRoot(config);
      const lifecycle = await createFileTaskLifecycleStore({
        stateRoot,
        excludedRoots: [
          config.driveMount,
          fileURLToPath(new URL("../../../", import.meta.url)),
        ],
      }).read();
      const history = await readTaskCreationHistory(stateRoot, {
        target: input.target,
        listId: input.listId,
      });
      return (await openStore()).capture({
        ...input,
        lifecycle: {
          ...lifecycle,
          entries: lifecycle.entries.filter(
            (entry) =>
              entry.target.kind === input.target.kind &&
              entry.target.key === input.target.key,
          ),
        },
        sources: history.flatMap((record) =>
          record.taskId === null || record.plan.sourceOccurrenceId === undefined
            ? []
            : [
                {
                  taskId: record.taskId,
                  sourceOccurrenceId: record.plan.sourceOccurrenceId,
                  operationId: record.plan.operationId,
                  planDigest: record.planDigest,
                },
              ],
        ),
      });
    },
  };
}
