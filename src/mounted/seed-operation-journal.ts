import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ResearchProjectSeedPlan,
  SeedOutcome,
  SeedPlan,
} from "../seed/index.js";
import {
  isCanonicalBase64,
  seedFileBytes,
} from "../seed/seed-operation-bytes.js";

export interface ModuleSeedTargetIdentity {
  module: string;
  semester: string;
  semesterRoot: string;
  moduleRoot: string;
}

export interface ResearchProjectSeedTargetIdentity {
  kind: "research-project";
  projectKey: string;
  folder: string;
  parentRoot: string;
  projectRoot: string;
}

export type SeedTargetIdentity =
  | ModuleSeedTargetIdentity
  | ResearchProjectSeedTargetIdentity;

export type SeedablePlan = SeedPlan | ResearchProjectSeedPlan;

export interface SeedPreconditions {
  contractVersion: number | "unavailable";
  targetState: "absent" | "partial";
  completedOperations: string[];
  remainingOperations: string[];
}

interface SeedJournalBase {
  schemaVersion: 1 | 2;
  runId: string;
  sequence: number;
  recordedAt: string;
  target: SeedTargetIdentity;
}

export interface SeedJournalStarted extends SeedJournalBase {
  type: "started";
  planDigest: string;
  plan: SeedablePlan;
  preconditions: SeedPreconditions;
  stagingRoot: string;
  ownership?: SeedOwnershipBaseline;
}

export interface SeedEntryIdentity {
  device: string;
  inode: string;
}

export interface SeedDirectoryClaim {
  path: string;
  identity: SeedEntryIdentity;
}

export interface SeedOwnershipBaseline {
  parent: SeedEntryIdentity;
  publicationDirectories: SeedDirectoryClaim[];
}

export type SeedOwnershipEvent =
  | { type: "stage-planned"; generation: number; stagingRoot: string }
  | { type: "stage-claimed"; generation: number; identity: SeedEntryIdentity }
  | {
      type: "entry-created";
      phase: "staging" | "publication";
      generation: number;
      operation: { kind: "directory" | "file"; path: string };
      identity: SeedEntryIdentity;
      sha256?: string;
    }
  | { type: "stage-entry-removing"; generation: number; path: string }
  | { type: "stage-cleaned"; generation: number };

export interface SeedRootClaim {
  type: "root-claimed";
  device: string;
  inode: string;
}

export type SeedJournalEvent =
  | SeedJournalStarted
  | (SeedJournalBase & SeedOwnershipEvent)
  | (SeedJournalBase & SeedRootClaim)
  | (SeedJournalBase & {
      type: "operation-completed";
      phase: "staging" | "publication";
      generation?: number;
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
  | SeedOwnershipEvent
  | SeedRootClaim
  | {
      type: "operation-completed";
      phase: "staging" | "publication";
      generation?: number;
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

export function seedPlanDigest(plan: SeedablePlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function seedJournalPath(
  stateRoot: string,
  target: SeedTargetIdentity,
): string {
  const targetKey = createHash("sha256")
    .update(seedTargetRoot(target))
    .digest("hex");
  return join(stateRoot, "journals", "seeds", `${targetKey}.jsonl`);
}

export async function startSeedJournal(input: {
  path: string;
  target: SeedTargetIdentity;
  plan: SeedablePlan;
  preconditions: SeedPreconditions;
  stagingRoot: string;
  ownership: SeedOwnershipBaseline;
}): Promise<SeedJournal> {
  const started: SeedJournalStarted = {
    schemaVersion: 2,
    type: "started",
    runId: randomUUID(),
    sequence: 0,
    recordedAt: new Date().toISOString(),
    target: input.target,
    planDigest: seedPlanDigest(input.plan),
    plan: input.plan,
    preconditions: input.preconditions,
    stagingRoot: input.stagingRoot,
    ownership: input.ownership,
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
  if (!targetMatchesPlan(started.target, started.plan)) {
    return {
      diagnostic: "Seed journal contains a mismatched target identity.",
    };
  }
  if (
    events.some(
      (event, index) =>
        event.runId !== started.runId ||
        event.sequence !== index ||
        event.schemaVersion !== started.schemaVersion,
    )
  ) {
    return {
      diagnostic: "Seed continuation has an ambiguous journal sequence.",
    };
  }
  if (started.schemaVersion === 2 && started.ownership !== undefined) {
    const paths = started.ownership.publicationDirectories.map(
      (entry) => entry.path,
    );
    if (
      new Set(paths).size !== paths.length ||
      (started.preconditions.targetState === "absent"
        ? paths.length !== 0
        : !paths.includes("")) ||
      paths.some(
        (path) =>
          path !== "" &&
          !started.plan.operations.some(
            (operation) =>
              operation.kind === "directory" && operation.path === path,
          ),
      )
    ) {
      return {
        diagnostic:
          "Seed continuation has an ambiguous journal ownership baseline.",
      };
    }
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
    schemaVersion: journal.started.schemaVersion,
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
    (event.schemaVersion !== 1 && event.schemaVersion !== 2) ||
    typeof event.runId !== "string" ||
    !Number.isInteger(event.sequence) ||
    typeof event.recordedAt !== "string" ||
    typeof target !== "object" ||
    target === null ||
    Array.isArray(target)
  ) {
    return false;
  }
  if (!isSeedTargetIdentity(target)) {
    return false;
  }
  if (event.type === "started") {
    return (
      typeof event.planDigest === "string" &&
      typeof event.stagingRoot === "string" &&
      isSeedPlan(event.plan) &&
      isSeedPreconditions(event.preconditions) &&
      (event.schemaVersion === 1 || isOwnershipBaseline(event.ownership))
    );
  }
  if (
    [
      "stage-planned",
      "stage-claimed",
      "entry-created",
      "stage-entry-removing",
      "stage-cleaned",
    ].some((type) => type === event.type)
  ) {
    return event.schemaVersion === 2 && isOwnershipEvent(event);
  }
  if (event.type === "root-claimed") {
    return (
      typeof event.device === "string" &&
      /^\d+$/u.test(event.device) &&
      typeof event.inode === "string" &&
      /^\d+$/u.test(event.inode)
    );
  }
  if (event.type === "operation-completed") {
    return (
      (event.phase === "staging" || event.phase === "publication") &&
      isPublicOperation(event.operation) &&
      (event.generation === undefined ||
        (Number.isSafeInteger(event.generation) &&
          Number(event.generation) >= 0))
    );
  }
  if (event.type === "failure") {
    return (
      (event.phase === "staging" ||
        event.phase === "verification" ||
        event.phase === "publication" ||
        event.phase === "finalization") &&
      typeof event.evidence === "string"
    );
  }
  return (
    event.type === "outcome" &&
    (event.outcome === "blocked" ||
      event.outcome === "partially-completed" ||
      event.outcome === "completed")
  );
}

function hasValidJournalLifecycle(events: SeedJournalEvent[]): boolean {
  const completedOperations = new Set<string>();
  let claimed = false;
  let published = false;
  const ownership = {
    generation: 0,
    claimed: false,
    cleaned: false,
    entries: new Set<string>(),
    removing: new Set<string>(),
  };
  const stagePaths = new Set<string>();
  const publicationEntries = new Set<string>();
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
    const started = events[0];
    if (started?.type !== "started") return false;
    if (event.type === "stage-planned") {
      if (
        !ownership.cleaned ||
        event.generation !== ownership.generation + 1 ||
        event.stagingRoot === started.stagingRoot ||
        stagePaths.has(event.stagingRoot)
      )
        return false;
      stagePaths.add(event.stagingRoot);
      ownership.generation = event.generation;
      ownership.claimed = false;
      ownership.cleaned = false;
      ownership.entries.clear();
      ownership.removing.clear();
    }
    if (event.type === "stage-claimed") {
      if (
        event.generation !== ownership.generation ||
        ownership.claimed ||
        ownership.cleaned
      )
        return false;
      ownership.claimed = true;
    }
    if (event.type === "entry-created") {
      const approved = started.plan.operations.find(
        (operation) =>
          operation.path === event.operation.path &&
          operation.kind === event.operation.kind,
      );
      if (
        approved === undefined ||
        (approved.kind === "file" &&
          createHash("sha256").update(seedFileBytes(approved)).digest("hex") !==
            event.sha256)
      )
        return false;
      if (event.phase === "staging") {
        if (
          !ownership.claimed ||
          ownership.cleaned ||
          ownership.removing.size > 0 ||
          event.generation !== ownership.generation ||
          ownership.entries.has(event.operation.path)
        )
          return false;
        ownership.entries.add(event.operation.path);
      } else {
        if (
          event.generation !== 0 ||
          (started.preconditions.targetState === "absent" && !claimed) ||
          publicationEntries.has(event.operation.path)
        )
          return false;
        publicationEntries.add(event.operation.path);
      }
    }
    if (event.type === "stage-entry-removing") {
      if (
        !ownership.claimed ||
        ownership.cleaned ||
        event.generation !== ownership.generation ||
        ownership.removing.has(event.path) ||
        (event.path !== "" && !ownership.entries.has(event.path))
      )
        return false;
      if (
        event.path === "" &&
        [...ownership.entries].some((path) => !ownership.removing.has(path))
      )
        return false;
      ownership.removing.add(event.path);
    }
    if (event.type === "stage-cleaned") {
      if (
        event.generation !== ownership.generation ||
        ownership.cleaned ||
        (ownership.claimed && !ownership.removing.has(""))
      )
        return false;
      ownership.cleaned = true;
    }
    if (started.schemaVersion === 2 && event.type === "operation-completed") {
      if (
        !started.plan.operations.some(
          (operation) =>
            operation.path === event.operation.path &&
            operation.kind === event.operation.kind,
        )
      )
        return false;
      if (
        event.phase === "staging" &&
        (!ownership.claimed ||
          ownership.cleaned ||
          event.generation !== ownership.generation ||
          !ownership.entries.has(event.operation.path))
      )
        return false;
      if (
        event.phase === "publication" &&
        started.preconditions.targetState === "absent" &&
        !claimed
      )
        return false;
    }
    if (
      started.schemaVersion === 2 &&
      event.type === "outcome" &&
      event.outcome === "completed" &&
      !ownership.cleaned
    )
      return false;
    if (event.type === "root-claimed") {
      const started = events[0];
      if (
        claimed ||
        published ||
        started?.type !== "started" ||
        started.preconditions.targetState !== "absent"
      )
        return false;
      claimed = true;
    }
    if (event.type === "operation-completed") {
      if (event.phase === "publication") published = true;
      const key = `${event.phase}\u0000${event.generation ?? 0}\u0000${event.operation.path}`;
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

function isEntryIdentity(value: unknown): value is SeedEntryIdentity {
  return (
    isRecord(value) &&
    ["device", "inode"].every(
      (key) => typeof value[key] === "string" && /^\d+$/u.test(value[key]),
    )
  );
}

function isOwnershipBaseline(value: unknown): value is SeedOwnershipBaseline {
  return (
    isRecord(value) &&
    isEntryIdentity(value.parent) &&
    Array.isArray(value.publicationDirectories) &&
    value.publicationDirectories.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.path === "string" &&
        isEntryIdentity(entry.identity),
    )
  );
}

function isOwnershipEvent(event: Record<string, unknown>): boolean {
  if (!Number.isSafeInteger(event.generation) || Number(event.generation) < 0)
    return false;
  if (event.type === "stage-planned")
    return typeof event.stagingRoot === "string";
  if (event.type === "stage-claimed") return isEntryIdentity(event.identity);
  if (event.type === "stage-cleaned") return true;
  if (event.type === "stage-entry-removing")
    return typeof event.path === "string";
  if (event.type === "entry-created")
    return (
      (event.phase === "staging" || event.phase === "publication") &&
      isPublicOperation(event.operation) &&
      isEntryIdentity(event.identity) &&
      isRecord(event.operation) &&
      (event.operation.kind === "directory"
        ? event.sha256 === undefined
        : typeof event.sha256 === "string" &&
          /^[a-f0-9]{64}$/u.test(event.sha256))
    );
  return false;
}

function isSeedPlan(value: unknown): value is SeedablePlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const plan = value as Record<string, unknown>;
  const common =
    Array.isArray(plan.operations) &&
    plan.operations.every(isSeedOperation) &&
    Array.isArray(plan.blockers) &&
    plan.blockers.every((blocker) => typeof blocker === "string");
  if (!common) return false;
  if (typeof plan.module === "string" || typeof plan.semester === "string") {
    return typeof plan.module === "string" && typeof plan.semester === "string";
  }
  if (!isRecord(plan.target)) return false;
  return (
    plan.target.kind === "research-project" &&
    typeof plan.target.key === "string" &&
    typeof plan.target.folder === "string" &&
    Number.isInteger(plan.contractVersion)
  );
}

function isSeedTargetIdentity(target: unknown): target is SeedTargetIdentity {
  if (!isRecord(target)) return false;
  if ("kind" in target) {
    return (
      target.kind === "research-project" &&
      ["projectKey", "folder", "parentRoot", "projectRoot"].every(
        (field) => typeof target[field] === "string",
      )
    );
  }
  return ["module", "semester", "semesterRoot", "moduleRoot"].every(
    (field) => typeof target[field] === "string",
  );
}

export function seedTargetRoot(target: SeedTargetIdentity): string {
  return isResearchSeedTarget(target) ? target.projectRoot : target.moduleRoot;
}

export function seedTargetParentRoot(target: SeedTargetIdentity): string {
  return isResearchSeedTarget(target) ? target.parentRoot : target.semesterRoot;
}

export function seedTargetLabel(target: SeedTargetIdentity): string {
  return isResearchSeedTarget(target) ? target.folder : target.module;
}

function targetMatchesPlan(
  target: SeedTargetIdentity,
  plan: SeedablePlan,
): boolean {
  if (isResearchSeedTarget(target)) {
    return (
      "target" in plan &&
      plan.target.kind === "research-project" &&
      plan.target.key === target.projectKey &&
      plan.target.folder === target.folder
    );
  }
  return (
    "module" in plan &&
    plan.module === target.module &&
    plan.semester === target.semester
  );
}

function isResearchSeedTarget(
  target: SeedTargetIdentity,
): target is ResearchProjectSeedTargetIdentity {
  return "kind" in target && target.kind === "research-project";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeedOperation(value: unknown): boolean {
  if (!isPublicOperation(value)) return false;
  const operation = value as Record<string, unknown>;
  if (operation.kind === "directory") {
    return (
      operation.contents === undefined && operation.contentsBase64 === undefined
    );
  }
  if (operation.contentsBase64 !== undefined) {
    return (
      operation.contents === undefined &&
      typeof operation.contentsBase64 === "string" &&
      isCanonicalBase64(operation.contentsBase64)
    );
  }
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
    (operation.kind === "directory" || operation.kind === "file") &&
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
    (preconditions.targetState === "absent" ||
      preconditions.targetState === "partial") &&
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
