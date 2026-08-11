import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SeedOutcome, SeedPlan } from "../seed/index.js";

export interface SeedTargetIdentity {
  module: string;
  semester: string;
  semesterRoot: string;
  moduleRoot: string;
}

export interface SeedPreconditions {
  contractVersion: number | "unavailable";
  targetState: "absent" | "partial";
  completedOperations: string[];
  remainingOperations: string[];
}

interface SeedJournalBase {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  recordedAt: string;
  target: SeedTargetIdentity;
}

export interface SeedJournalStarted extends SeedJournalBase {
  type: "started";
  planDigest: string;
  plan: SeedPlan;
  preconditions: SeedPreconditions;
  stagingRoot: string;
}

export type SeedJournalEvent =
  | SeedJournalStarted
  | (SeedJournalBase & {
      type: "operation-completed";
      phase: "staging" | "publication";
      operation: { kind: "directory" | "file"; path: string };
    })
  | (SeedJournalBase & {
      type: "failure";
      phase: "staging" | "verification" | "publication" | "finalization";
      evidence: string;
    })
  | (SeedJournalBase & {
      type: "outcome";
      outcome: Extract<
        SeedOutcome,
        "blocked" | "partially-completed" | "completed"
      >;
    });

type SeedJournalAppendEvent =
  | {
      type: "operation-completed";
      phase: "staging" | "publication";
      operation: { kind: "directory" | "file"; path: string };
    }
  | {
      type: "failure";
      phase: "staging" | "verification" | "publication" | "finalization";
      evidence: string;
    }
  | {
      type: "outcome";
      outcome: Extract<
        SeedOutcome,
        "blocked" | "partially-completed" | "completed"
      >;
    };

export interface SeedJournal {
  path: string;
  started: SeedJournalStarted;
  events: SeedJournalEvent[];
}

export function seedPlanDigest(plan: SeedPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function seedJournalPath(
  stateRoot: string,
  target: SeedTargetIdentity,
): string {
  const targetKey = createHash("sha256")
    .update(target.moduleRoot)
    .digest("hex");
  return join(stateRoot, "journals", "seeds", `${targetKey}.jsonl`);
}

export async function startSeedJournal(input: {
  path: string;
  target: SeedTargetIdentity;
  plan: SeedPlan;
  preconditions: SeedPreconditions;
  stagingRoot: string;
}): Promise<SeedJournal> {
  const started: SeedJournalStarted = {
    schemaVersion: 1,
    type: "started",
    runId: randomUUID(),
    sequence: 0,
    recordedAt: new Date().toISOString(),
    target: input.target,
    planDigest: seedPlanDigest(input.plan),
    plan: input.plan,
    preconditions: input.preconditions,
    stagingRoot: input.stagingRoot,
  };
  await mkdir(dirname(input.path), { recursive: true, mode: 0o700 });
  const file = await open(input.path, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(started)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(dirname(input.path));
  return { path: input.path, started, events: [started] };
}

export async function readSeedJournal(
  path: string,
): Promise<{ journal?: SeedJournal; diagnostic?: string }> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    return { diagnostic: "Seed journal cannot be read." };
  }
  const lines = source.split("\n").filter((line) => line.length > 0);
  const events: SeedJournalEvent[] = [];
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return {
        diagnostic: "Seed continuation has an ambiguous journal entry.",
      };
    }
    if (!isSeedJournalEvent(value)) {
      return {
        diagnostic: "Seed continuation has an ambiguous journal entry.",
      };
    }
    events.push(value);
  }
  const started = events[0];
  if (started?.type !== "started") {
    return { diagnostic: "Seed continuation has an ambiguous journal start." };
  }
  if (
    events.some(
      (event, index) =>
        event.runId !== started.runId || event.sequence !== index,
    )
  ) {
    return {
      diagnostic: "Seed continuation has an ambiguous journal sequence.",
    };
  }
  if (!hasValidJournalLifecycle(events)) {
    return {
      diagnostic: "Seed continuation has an ambiguous journal lifecycle.",
    };
  }
  return { journal: { path, started, events } };
}

export async function appendSeedJournalEvent(
  journal: SeedJournal,
  event: SeedJournalAppendEvent,
): Promise<void> {
  const complete = {
    schemaVersion: 1,
    runId: journal.started.runId,
    sequence: journal.events.length,
    recordedAt: new Date().toISOString(),
    target: journal.started.target,
    ...event,
  } as SeedJournalEvent;
  const file = await open(journal.path, "a", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(complete)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  journal.events.push(complete);
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isSeedJournalEvent(value: unknown): value is SeedJournalEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  const target = event.target;
  if (
    event.schemaVersion !== 1 ||
    typeof event.runId !== "string" ||
    !Number.isInteger(event.sequence) ||
    typeof event.recordedAt !== "string" ||
    typeof target !== "object" ||
    target === null ||
    Array.isArray(target)
  ) {
    return false;
  }
  const targetRecord = target as Record<string, unknown>;
  if (
    !["module", "semester", "semesterRoot", "moduleRoot"].every(
      (field) => typeof targetRecord[field] === "string",
    )
  ) {
    return false;
  }
  if (event.type === "started") {
    return (
      typeof event.planDigest === "string" &&
      typeof event.stagingRoot === "string" &&
      isSeedPlan(event.plan) &&
      isSeedPreconditions(event.preconditions)
    );
  }
  if (event.type === "operation-completed") {
    return (
      ["staging", "publication"].includes(String(event.phase)) &&
      isPublicOperation(event.operation)
    );
  }
  if (event.type === "failure") {
    return (
      ["staging", "verification", "publication", "finalization"].includes(
        String(event.phase),
      ) && typeof event.evidence === "string"
    );
  }
  return (
    event.type === "outcome" &&
    ["blocked", "partially-completed", "completed"].includes(
      String(event.outcome),
    )
  );
}

function hasValidJournalLifecycle(events: SeedJournalEvent[]): boolean {
  const completedOperations = new Set<string>();
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    const previous = events[index - 1];
    if (
      event === undefined ||
      previous === undefined ||
      event.type === "started"
    ) {
      return false;
    }
    if (previous.type === "failure" && event.type !== "outcome") {
      return false;
    }
    if (
      previous.type === "failure" &&
      event.type === "outcome" &&
      event.outcome === "completed"
    ) {
      return false;
    }
    if (event.type === "operation-completed") {
      const key = `${event.phase}\u0000${event.operation.path}`;
      if (completedOperations.has(key)) return false;
      completedOperations.add(key);
    }
    if (
      event.type === "outcome" &&
      event.outcome !== "completed" &&
      previous.type !== "failure"
    ) {
      return false;
    }
    if (
      event.type === "outcome" &&
      event.outcome === "completed" &&
      index !== events.length - 1
    ) {
      return false;
    }
  }
  return events.at(-1)?.type !== "failure";
}

function isSeedPlan(value: unknown): value is SeedPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.module === "string" &&
    typeof plan.semester === "string" &&
    Array.isArray(plan.operations) &&
    plan.operations.every(isSeedOperation) &&
    Array.isArray(plan.blockers) &&
    plan.blockers.every((blocker) => typeof blocker === "string")
  );
}

function isSeedOperation(value: unknown): boolean {
  if (!isPublicOperation(value)) return false;
  const operation = value as Record<string, unknown>;
  return (
    operation.contents === undefined || typeof operation.contents === "string"
  );
}

function isPublicOperation(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const operation = value as Record<string, unknown>;
  return (
    ["directory", "file"].includes(String(operation.kind)) &&
    typeof operation.path === "string"
  );
}

function isSeedPreconditions(value: unknown): value is SeedPreconditions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const preconditions = value as Record<string, unknown>;
  return (
    (typeof preconditions.contractVersion === "number" ||
      preconditions.contractVersion === "unavailable") &&
    ["absent", "partial"].includes(String(preconditions.targetState)) &&
    Array.isArray(preconditions.completedOperations) &&
    preconditions.completedOperations.every(
      (path) => typeof path === "string",
    ) &&
    Array.isArray(preconditions.remainingOperations) &&
    preconditions.remainingOperations.every((path) => typeof path === "string")
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
