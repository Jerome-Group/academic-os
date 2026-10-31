import type { NativeTaskTimingObservation } from "./native-task-timing.js";
import type { TaskLifecycleState } from "./task-lifecycle.js";
import type { LiveTask, TaskRegister, TaskTargetIdentity } from "./types.js";

export interface TaskRecoveryOperation {
  operationId: string;
  planDigest: string;
  phase: string;
  taskId: string | null;
  sourceOccurrenceId?: string;
}

export interface TaskRecoverySource {
  taskId: string;
  sourceOccurrenceId: string;
  operationId: string;
  planDigest: string;
}

export interface TaskRecoveryCapture {
  target: TaskTargetIdentity;
  listId: string;
  register: TaskRegister;
  live: LiveTask[];
  reason: "refresh" | "before-operation" | "after-operation";
  operation?: TaskRecoveryOperation;
  nativeTiming?: NativeTaskTimingObservation;
  lifecycle?: TaskLifecycleState;
  sources?: TaskRecoverySource[];
}

export interface TaskRecoveryCoverage {
  planningTimeZone: "Asia/Singapore";
  provider: "complete-observation";
  register: "historical-local-state";
  nativeTiming: "unavailable" | "observed";
}

export interface TaskRecoverySnapshot extends TaskRecoveryCapture {
  schemaVersion: 1;
  snapshotId: string;
  capturedAt: string;
  nativeTiming: NativeTaskTimingObservation;
  coverage: TaskRecoveryCoverage;
}

export interface TaskRecoverySummary {
  snapshotId: string;
  capturedAt: string;
  target: TaskTargetIdentity;
  listId: string;
  reason: TaskRecoveryCapture["reason"];
  coverage: TaskRecoveryCoverage;
  taskCount: number;
  registerTaskCount: number;
  operation?: TaskRecoveryOperation;
}

export interface TaskRecoveryStore {
  capture(input: TaskRecoveryCapture): Promise<TaskRecoverySnapshot>;
  read(snapshotId: string): Promise<TaskRecoverySnapshot>;
  list(target: TaskTargetIdentity): Promise<TaskRecoverySummary[]>;
  retain(snapshotId: string, reference: string): Promise<void>;
  release(snapshotId: string, reference: string): Promise<void>;
  withSnapshot<T>(
    snapshotId: string,
    run: (snapshot: TaskRecoverySnapshot) => Promise<T>,
  ): Promise<T>;
}

export interface TaskRecoveryRetention {
  maxSnapshots: number;
  maxAgeDays: number;
  maxBytes: number;
}
