import type { TaskLifecycleMutationSession } from "./file-task-lifecycle-store.js";
import type { TaskRegisterTarget } from "./refresh-task-registers.js";
import type { TaskRecoveryStore } from "./task-recovery-types.js";
import type {
  TaskOperationWriter,
  TaskRefreshReader,
  TaskTargetIdentity,
} from "./types.js";

export interface TaskRestorePlan {
  schemaVersion: "task-restore/1";
  operationId: string;
  target: TaskTargetIdentity;
  listId: string;
  snapshotId: string;
  originalTaskId: string;
  sourceOccurrenceId: string;
  expectedSnapshot: string;
  expectedLifecycleRevision: number;
  policyVersion: string;
  ownerApprovalRef: string;
  scheduling: { mode: "api-fields-only"; acknowledgeTimingLoss: true };
}

export interface TaskRestoreResult {
  schemaVersion: 1;
  operationId: string;
  outcome: "preview" | "applied" | "conflict" | "failed" | "uncertain";
  taskId: string | null;
  originalTaskId: string;
  newTaskId: string | null;
  snapshotId: string;
  registerFresh: boolean;
  nativeTimingRestored: false;
  identityHistoryRestored: false;
  code?: string;
  unsupportedFields?: string[];
}

export interface TaskRestoreJournalRecord {
  schemaVersion: 1;
  plan: TaskRestorePlan;
  planDigest: string;
  phase: "prepared" | "sending" | "verified" | "applied" | "rejected";
  taskId: string | null;
}

export interface TaskRestoreJournalSession {
  read(): Promise<TaskRestoreJournalRecord | undefined>;
  write(record: TaskRestoreJournalRecord): Promise<void>;
}

export interface TaskRestoreJournal {
  withOwner<T>(
    scope: {
      operationId: string;
      listId: string;
      target: Pick<TaskTargetIdentity, "kind" | "key">;
      originalTaskId: string;
      sourceOccurrenceId: string;
    },
    run: (session: TaskRestoreJournalSession) => Promise<T>,
  ): Promise<T>;
}

export interface TaskRestoreInput {
  apply?: boolean;
  plan: TaskRestorePlan;
  target: TaskRegisterTarget;
  reader: TaskRefreshReader;
  writer: TaskOperationWriter;
  recovery: TaskRecoveryStore;
  lifecycle: TaskLifecycleMutationSession;
  journal: TaskRestoreJournal;
}
