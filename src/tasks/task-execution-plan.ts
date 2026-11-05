import { sha256 } from "../checksum.js";
import { parseNativeTaskTimingPlan } from "./native-task-timing.js";
import { isDoDate } from "./do-date.js";
import type { TaskExecutionPlan } from "./task-execution-types.js";
import type {
  LiveTask,
  TaskOperation,
  TaskRegisterProvenance,
} from "./types.js";

export function parseTaskExecutionPlan(value: unknown): TaskExecutionPlan {
  const plan = record(value);
  keys(plan, [
    "schemaVersion",
    "operationId",
    "target",
    "listId",
    "expectedSnapshot",
    "operation",
    "sourceOccurrenceId",
    "policyVersion",
    "timing",
  ]);
  if (plan.schemaVersion !== 1)
    throw new Error("Unsupported task execution plan.");
  const target = record(plan.target);
  keys(target, ["kind", "key", "title"]);
  if (target.kind !== "module" && target.kind !== "research-project")
    throw new Error("Invalid task target.");
  const operation = parseOperation(plan.operation, target.kind);
  const sourceOccurrenceId = optionalText(plan.sourceOccurrenceId);
  if (operation.name === "create" && sourceOccurrenceId === undefined)
    throw new Error("A create requires an exact source occurrence.");
  const expectedSnapshot = text(plan.expectedSnapshot);
  if (!/^[a-f0-9]{64}$/u.test(expectedSnapshot))
    throw new Error("Invalid expected task snapshot.");
  return {
    schemaVersion: 1,
    operationId: text(plan.operationId, 200),
    target: {
      kind: target.kind,
      key: text(target.key),
      title: text(target.title),
    },
    listId: text(plan.listId),
    expectedSnapshot,
    operation,
    ...(sourceOccurrenceId === undefined ? {} : { sourceOccurrenceId }),
    policyVersion: text(plan.policyVersion, 200),
    ...(plan.timing === undefined
      ? {}
      : { timing: parseNativeTaskTimingPlan(plan.timing) }),
  };
}

export function taskExecutionSnapshot(
  tasks: readonly (LiveTask & { etag?: string; updated?: string })[],
): string {
  if (!Array.isArray(tasks)) throw new Error("Invalid provider task snapshot.");
  const ids = new Set<string>();
  const entries = tasks.map((task) => {
    const value = record(task);
    const id = text(value.id);
    if (ids.has(id)) throw new Error("Duplicate provider task identity.");
    ids.add(id);
    if (
      value.status !== undefined &&
      value.status !== "needsAction" &&
      value.status !== "completed"
    )
      throw new Error("Invalid provider task status.");
    return {
      id,
      title: providerText(value.title) ?? "",
      notes: providerText(value.notes) ?? "",
      due: providerText(value.due),
      status: value.status ?? "needsAction",
      deleted: providerBoolean(value.deleted),
      hidden: providerBoolean(value.hidden),
      etag: providerText(value.etag),
      updated: providerText(value.updated),
      completed: providerText(value.completed),
      parent: providerText(value.parent),
      position: providerText(value.position),
    };
  });
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sha256(JSON.stringify(entries));
}

export function taskExecutionPlanDigest(plan: TaskExecutionPlan): string {
  return sha256(JSON.stringify(canonical(parseTaskExecutionPlan(plan))));
}

function parseOperation(
  value: unknown,
  kind: "module" | "research-project",
): TaskOperation {
  const operation = record(value);
  if (operation.name === "create") {
    keys(operation, ["name", "title", "doDate", "provenance"]);
    const doDate = date(operation.doDate);
    const provenance = parseProvenance(operation.provenance, kind);
    return {
      name: "create",
      title: text(operation.title),
      ...(doDate === undefined ? {} : { doDate }),
      ...(provenance === undefined ? {} : { provenance }),
    };
  }
  if (operation.name === "change") {
    keys(operation, ["name", "taskId", "title", "doDate"]);
    const title = optionalText(operation.title);
    const doDate = date(operation.doDate);
    if (title === undefined && doDate === undefined)
      throw new Error("A change requires exact fields.");
    return {
      name: "change",
      taskId: text(operation.taskId),
      ...(title === undefined ? {} : { title }),
      ...(doDate === undefined ? {} : { doDate }),
    };
  }
  if (operation.name === "complete" || operation.name === "cancel") {
    keys(operation, ["name", "taskId"]);
    return { name: operation.name, taskId: text(operation.taskId) };
  }
  throw new Error("Invalid task operation.");
}

function parseProvenance(
  value: unknown,
  kind: "module" | "research-project",
): TaskRegisterProvenance | undefined {
  if (value === undefined) return undefined;
  const provenance = record(value);
  const allowed =
    kind === "module"
      ? ["assessment", "source", "milestone"]
      : [
          "assessment",
          "source",
          "milestone",
          "claim",
          "meeting",
          "deliverable",
        ];
  keys(provenance, allowed);
  return Object.fromEntries(
    allowed.flatMap((key) =>
      provenance[key] === undefined ? [] : [[key, text(provenance[key])]],
    ),
  );
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown task plan field.");
}

function text(value: unknown, maximum = 1024): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maximum
  )
    throw new Error("Invalid task plan text.");
  return value;
}

function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}

function date(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isDoDate(value))
    throw new Error("A task do-date must be a calendar day.");
  return value;
}

function providerText(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string")
    throw new Error("Invalid provider task field.");
  return value;
}

function providerBoolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean")
    throw new Error("Invalid provider task flag.");
  return value;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)]),
  );
}
