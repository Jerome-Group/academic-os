import type { NativeTaskTimingPlan } from "./native-task-timing.js";
import type { TaskRegisterTarget } from "./refresh-task-registers.js";
import type {
  LiveTask,
  TaskOperation,
  TaskOperationWriter,
  TaskRefreshReader,
  TaskRegister,
  TaskTargetIdentity,
} from "./types.js";

export interface TaskExecutionPlan {
  schemaVersion: 1;
  operationId: string;
  target: TaskTargetIdentity;
  listId: string;
  expectedSnapshot: string;
  operation: TaskOperation;
  sourceOccurrenceId?: string;
  policyVersion: string;
  timing?: NativeTaskTimingPlan;
}

export interface TaskExecutionResult {
  schemaVersion: 1;
  operationId: string;
  outcome: "applied" | "conflict" | "uncertain" | "failed";
  taskId: string | null;
  registerFresh: boolean;
  code?: string;
}

export interface TaskExecutionChecks {
  beforeWrite?(input: {
    plan: TaskExecutionPlan;
    live: LiveTask[];
    register: TaskRegister;
  }): Promise<undefined | string>;
  afterApplied?(input: {
    plan: TaskExecutionPlan;
    taskId: string;
    live: LiveTask[];
  }): Promise<void>;
}

export interface TaskOperationJournalRecord {
  schemaVersion: 1;
  plan: TaskExecutionPlan;
  planDigest: string;
  phase: "prepared" | "uncertain" | "verified" | "applied" | "rejected";
  taskId: string | null;
}

export interface TaskOperationJournalSession {
  read(): Promise<TaskOperationJournalRecord | undefined>;
  write(record: TaskOperationJournalRecord): Promise<void>;
}

export interface TaskOperationJournal {
  withOwner<T>(
    scope: {
      operationId: string;
      listId: string;
      sourceOccurrence?: {
        target: Pick<TaskTargetIdentity, "kind" | "key">;
        id: string;
      };
    },
    run: (session: TaskOperationJournalSession) => Promise<T>,
  ): Promise<T>;
}

export interface TaskExecutionInput {
  plan: TaskExecutionPlan;
  target: TaskRegisterTarget;
  reader: TaskRefreshReader;
  writer: TaskOperationWriter;
  journal: TaskOperationJournal;
  checks?: TaskExecutionChecks;
}

export type TaskExecutionReport = TaskExecutionResult;
