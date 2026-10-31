import { sha256 } from "../checksum.js";
import type { TaskRestorePlan } from "./task-restore-types.js";

export function parseTaskRestorePlan(value: unknown): TaskRestorePlan {
  const plan = shape(value, [
    "schemaVersion",
    "operationId",
    "target",
    "listId",
    "snapshotId",
    "originalTaskId",
    "sourceOccurrenceId",
    "expectedSnapshot",
    "expectedLifecycleRevision",
    "policyVersion",
    "ownerApprovalRef",
    "scheduling",
  ]);
  const target = shape(plan.target, ["kind", "key", "title"]);
  const scheduling = shape(plan.scheduling, ["mode", "acknowledgeTimingLoss"]);
  if (
    plan.schemaVersion !== "task-restore/1" ||
    (target.kind !== "module" && target.kind !== "research-project") ||
    scheduling.mode !== "api-fields-only" ||
    scheduling.acknowledgeTimingLoss !== true ||
    !Number.isSafeInteger(plan.expectedLifecycleRevision) ||
    (plan.expectedLifecycleRevision as number) < 0
  )
    throw new Error("Invalid or unsupported Task restore plan.");
  const expectedSnapshot = text(plan.expectedSnapshot);
  if (!/^[a-f0-9]{64}$/u.test(expectedSnapshot))
    throw new Error(
      "A restore requires the complete fresh provider snapshot hash.",
    );
  return {
    schemaVersion: "task-restore/1",
    operationId: text(plan.operationId, 200),
    target: {
      kind: target.kind,
      key: text(target.key),
      title: text(target.title),
    },
    listId: text(plan.listId),
    snapshotId: text(plan.snapshotId),
    originalTaskId: text(plan.originalTaskId),
    sourceOccurrenceId: text(plan.sourceOccurrenceId),
    expectedSnapshot,
    expectedLifecycleRevision: plan.expectedLifecycleRevision as number,
    policyVersion: text(plan.policyVersion, 200),
    ownerApprovalRef: text(plan.ownerApprovalRef),
    scheduling: { mode: "api-fields-only", acknowledgeTimingLoss: true },
  };
}

export function taskRestorePlanDigest(plan: TaskRestorePlan): string {
  return sha256(JSON.stringify(canonical(parseTaskRestorePlan(plan))));
}

function shape(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error("Unknown or invalid Task restore plan fields.");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 1024): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new Error(
      "Task restore requires explicit nonempty identity and approval text.",
    );
  return value;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)]),
  );
}
