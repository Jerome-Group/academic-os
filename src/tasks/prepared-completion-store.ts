import type { TaskExecutionPlan } from "./task-execution-types.js";

export interface PreparedCompletion {
  schemaVersion: 1;
  operationId: string;
  packetJson: string;
  acquisitionEvidenceJson?: string;
  plan: TaskExecutionPlan;
  planDigest: string;
}

export interface PreparedCompletionStore {
  prepare(input: {
    packetJson: string;
    acquisitionEvidenceJson?: string;
    plan: TaskExecutionPlan;
  }): Promise<PreparedCompletion>;
  readEffect(effectKey: string): Promise<PreparedCompletion | undefined>;
  reserveEffect(effectKey: string, prepared: PreparedCompletion): Promise<void>;
  read(operationId: string): Promise<PreparedCompletion | undefined>;
}
